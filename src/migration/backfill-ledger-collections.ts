import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { transactionTypeVariants } from "@/lib/loan-transaction-type-variants";

/**
 * Track 3 of the ledger backfill: post one aggregate REPAYMENT-COLLECTION journal per loan that
 * has ever received a payment, using only `LoanInstallment.*PaidMinor` sums (the amounts actually
 * collected against principal/interest/fees/penalties). This mirrors the live app's actual
 * (cash-basis) accounting method in `post-repayment.ts` - interest/fees/penalties are recognized
 * as income only when collected, never accrued into a receivable first (the live code never
 * references `interestReceivableAccountId`). So the only receivable ever debited/credited is
 * principal.
 *
 * Waived amounts need no entry: they are already excluded from `*PaidMinor` (and were never
 * billed as outstanding), so this aggregate naturally matches the live app's ledger semantics.
 *
 * Per-transaction date precision is not recoverable (LoanTransactionAllocation, the per-payment
 * principal/interest/fee/penalty split, has 0 historical rows) - each loan's aggregate is dated
 * to its own last REPAYMENT-type LoanTransaction (falling back to disbursedOn if none exists),
 * so cumulative "as of" reports (Balance Sheet, dashboard) are exact, and non-cumulative
 * date-range reports (Income Statement, General Ledger) are reasonably-but-not-precisely dated.
 */

export type CollectionBackfillResult = Readonly<{
  loansConsidered: number;
  journalsCreated: number;
  alreadyPosted: number;
  skippedNoMapping: string[];
  skippedNoSettlement: number;
  skippedZeroPaid: number;
  totalCollectedMinor: bigint;
}>;

export async function backfillCollectionJournals(prisma: PrismaClient): Promise<CollectionBackfillResult> {
  const loans = await prisma.loan.findMany({
    where: { disbursedOn: { not: null } },
    select: {
      id: true,
      accountNumber: true,
      officeId: true,
      disbursedOn: true,
      product: { select: { accountingMapping: true } },
      installments: { select: { principalPaidMinor: true, interestPaidMinor: true, feesPaidMinor: true, penaltiesPaidMinor: true } },
    },
  });

  const settlementAccount = await prisma.settlementAccount.findFirst({ where: { name: "Cash", currencyCode: "UGX", active: true } });

  let journalsCreated = 0;
  let alreadyPosted = 0;
  let skippedNoSettlement = 0;
  let skippedZeroPaid = 0;
  const skippedNoMapping: string[] = [];
  let totalCollectedMinor = 0n;

  let processed = 0;
  for (const loan of loans) {
    processed += 1;
    if (processed % 50 === 0) console.log(`... processed ${processed}/${loans.length} loans`);

    const mapping = loan.product.accountingMapping;
    if (!mapping) {
      skippedNoMapping.push(loan.accountNumber);
      continue;
    }
    if (!settlementAccount) {
      skippedNoSettlement += 1;
      continue;
    }

    const principalPaid = loan.installments.reduce((sum, item) => sum + item.principalPaidMinor, 0n);
    const interestPaid = loan.installments.reduce((sum, item) => sum + item.interestPaidMinor, 0n);
    const feesPaid = loan.installments.reduce((sum, item) => sum + item.feesPaidMinor, 0n);
    const penaltiesPaid = loan.installments.reduce((sum, item) => sum + item.penaltiesPaidMinor, 0n);
    const totalPaid = principalPaid + interestPaid + feesPaid + penaltiesPaid;
    if (totalPaid <= 0n) {
      skippedZeroPaid += 1;
      continue;
    }

    const key = `backfill:collection:${loan.id}`;
    const existing = await prisma.journal.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      alreadyPosted += 1;
      continue;
    }

    const lastRepayment = await prisma.loanTransaction.findFirst({
      where: { loanId: loan.id, transactionType: { in: transactionTypeVariants("REPAYMENT") } },
      orderBy: { businessDate: "desc" },
      select: { businessDate: true },
    });
    const businessDate = lastRepayment?.businessDate ?? loan.disbursedOn!;

    const credits = [
      { accountId: mapping.principalReceivableAccountId, amount: principalPaid, memo: "Principal" },
      { accountId: mapping.interestIncomeAccountId, amount: interestPaid, memo: "Interest" },
      { accountId: mapping.feeIncomeAccountId, amount: feesPaid, memo: "Fees" },
      { accountId: mapping.penaltyIncomeAccountId, amount: penaltiesPaid, memo: "Penalties" },
    ].filter((line): line is { accountId: string; amount: bigint; memo: string } => Boolean(line.accountId) && line.amount > 0n);

    // If a component has no configured income account but has a nonzero paid amount (shouldn't
    // happen given the Track 1 bootstrap, but guard defensively), fold it into principal so the
    // journal still balances rather than silently dropping money from the ledger.
    const coveredAmount = credits.reduce((sum, line) => sum + line.amount, 0n);
    const uncovered = totalPaid - coveredAmount;
    if (uncovered > 0n) credits.push({ accountId: mapping.principalReceivableAccountId, amount: uncovered, memo: "Uncovered (fallback)" });

    try {
      await prisma.$transaction(
        async (tx) => {
          const journal = await tx.journal.create({
            data: {
              officeId: loan.officeId,
              businessDate,
              referenceType: "LOAN_COLLECTION_BACKFILL",
              referenceId: loan.id,
              narration: `Repayments collected (historical backfill) ${loan.accountNumber}`,
              idempotencyKey: key,
            },
          });
          await tx.journalLine.createMany({
            data: [
              { journalId: journal.id, accountId: settlementAccount.ledgerAccountId, direction: "DEBIT", amountMinor: totalPaid, memo: settlementAccount.name },
              ...credits.map((line) => ({ journalId: journal.id, accountId: line.accountId, direction: "CREDIT" as const, amountMinor: line.amount, memo: line.memo })),
            ],
          });
          await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
        },
        { timeout: 30_000, maxWait: 15_000 },
      );
      journalsCreated += 1;
      totalCollectedMinor += totalPaid;
    } catch (error) {
      console.error(`Collection journal failed for loan ${loan.accountNumber}: ${error instanceof Error ? error.message : error}`);
    }
  }

  return { loansConsidered: loans.length, journalsCreated, alreadyPosted, skippedNoMapping, skippedNoSettlement, skippedZeroPaid, totalCollectedMinor };
}

async function main() {
  try {
    const result = await backfillCollectionJournals(prisma);
    console.log("Collection journal backfill complete.");
    console.log(`Loans considered: ${result.loansConsidered}`);
    console.log(`Collection journals created: ${result.journalsCreated} (total collected ${result.totalCollectedMinor})`);
    console.log(`Already posted (skipped): ${result.alreadyPosted}`);
    console.log(`Skipped, zero paid: ${result.skippedZeroPaid}`);
    console.log(`Skipped, no settlement account: ${result.skippedNoSettlement}`);
    if (result.skippedNoMapping.length > 0) console.log(`Skipped, no product mapping: ${result.skippedNoMapping.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

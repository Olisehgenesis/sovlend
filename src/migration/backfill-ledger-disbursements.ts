import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { transactionTypeVariants } from "@/lib/loan-transaction-type-variants";

/**
 * Track 2 of the ledger backfill: post one aggregate DISBURSEMENT journal per historically
 * disbursed loan, using only data already stored (`Loan.principalMinor`/`disbursedOn`, plus any
 * `repaymentAtDisbursement` fee-at-disbursement amount recorded on the loan's transactions).
 *
 * This mirrors `disburse-loan.ts`'s exact journal shape (DEBIT principal receivable, CREDIT the
 * settlement/cash account) so historical and future postings are indistinguishable in the ledger.
 * It never touches `LoanTransaction` (append-only) - it only reads existing rows and writes new
 * `Journal`/`JournalLine` rows. Idempotent: safe to re-run, already-posted loans are skipped by
 * looking up the deterministic `Journal.idempotencyKey`.
 */

export type DisbursementBackfillResult = Readonly<{
  loansConsidered: number;
  journalsCreated: number;
  feeJournalsCreated: number;
  alreadyPosted: number;
  skippedNoMapping: string[];
  skippedNoSettlement: number;
  totalPrincipalMinor: bigint;
  totalFeeMinor: bigint;
}>;

export async function backfillDisbursementJournals(prisma: PrismaClient): Promise<DisbursementBackfillResult> {
  const loans = await prisma.loan.findMany({
    where: { disbursedOn: { not: null } },
    select: {
      id: true,
      accountNumber: true,
      officeId: true,
      principalMinor: true,
      disbursedOn: true,
      product: { select: { accountingMapping: true } },
    },
  });

  const settlementAccount = await prisma.settlementAccount.findFirst({ where: { name: "Cash", currencyCode: "UGX", active: true } });

  let journalsCreated = 0;
  let feeJournalsCreated = 0;
  let alreadyPosted = 0;
  let skippedNoSettlement = 0;
  const skippedNoMapping: string[] = [];
  let totalPrincipalMinor = 0n;
  let totalFeeMinor = 0n;

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
    const businessDate = loan.disbursedOn!;
    const disbursementKey = `backfill:disbursement:${loan.id}`;

    const existingDisbursement = await prisma.journal.findUnique({ where: { idempotencyKey: disbursementKey } });
    if (existingDisbursement) {
      alreadyPosted += 1;
    } else if (loan.principalMinor > 0n) {
      try {
        await prisma.$transaction(
          async (tx) => {
            const journal = await tx.journal.create({
              data: {
                officeId: loan.officeId,
                businessDate,
                referenceType: "LOAN_DISBURSEMENT_BACKFILL",
                referenceId: loan.id,
                narration: `Disbursement (historical backfill) ${loan.accountNumber}`,
                idempotencyKey: disbursementKey,
              },
            });
            await tx.journalLine.createMany({
              data: [
                { journalId: journal.id, accountId: mapping.principalReceivableAccountId, direction: "DEBIT", amountMinor: loan.principalMinor, memo: loan.accountNumber },
                { journalId: journal.id, accountId: settlementAccount.ledgerAccountId, direction: "CREDIT", amountMinor: loan.principalMinor, memo: settlementAccount.name },
              ],
            });
            await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
          },
          { timeout: 30_000, maxWait: 15_000 },
        );
        journalsCreated += 1;
        totalPrincipalMinor += loan.principalMinor;
      } catch (error) {
        console.error(`Disbursement journal failed for loan ${loan.accountNumber}: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Fee collected at disbursement time (Fineract's `repaymentAtDisbursement` transactions).
    // Not part of the amortized schedule, so it must be aggregated separately from LoanTransaction.
    const feeKey = `backfill:disbursement-fee:${loan.id}`;
    const existingFee = await prisma.journal.findUnique({ where: { idempotencyKey: feeKey } });
    if (existingFee) {
      alreadyPosted += 1;
    } else if (mapping.feeIncomeAccountId) {
      const feeAgg = await prisma.loanTransaction.aggregate({
        where: { loanId: loan.id, transactionType: { in: transactionTypeVariants("REPAYMENT_AT_DISBURSEMENT") } },
        _sum: { denominationAmountMinor: true },
      });
      const feeAmount = feeAgg._sum.denominationAmountMinor ?? 0n;
      if (feeAmount > 0n) {
        try {
          await prisma.$transaction(
            async (tx) => {
              const journal = await tx.journal.create({
                data: {
                  officeId: loan.officeId,
                  businessDate,
                  referenceType: "LOAN_DISBURSEMENT_FEE_BACKFILL",
                  referenceId: loan.id,
                  narration: `Fee collected at disbursement (historical backfill) ${loan.accountNumber}`,
                  idempotencyKey: feeKey,
                },
              });
              await tx.journalLine.createMany({
                data: [
                  { journalId: journal.id, accountId: settlementAccount.ledgerAccountId, direction: "DEBIT", amountMinor: feeAmount, memo: settlementAccount.name },
                  { journalId: journal.id, accountId: mapping.feeIncomeAccountId!, direction: "CREDIT", amountMinor: feeAmount, memo: `Fee at disbursement ${loan.accountNumber}` },
                ],
              });
              await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
            },
            { timeout: 30_000, maxWait: 15_000 },
          );
          feeJournalsCreated += 1;
          totalFeeMinor += feeAmount;
        } catch (error) {
          console.error(`Disbursement-fee journal failed for loan ${loan.accountNumber}: ${error instanceof Error ? error.message : error}`);
        }
      }
    }
  }

  return {
    loansConsidered: loans.length,
    journalsCreated,
    feeJournalsCreated,
    alreadyPosted,
    skippedNoMapping,
    skippedNoSettlement,
    totalPrincipalMinor,
    totalFeeMinor,
  };
}

async function main() {
  try {
    const result = await backfillDisbursementJournals(prisma);
    console.log("Disbursement journal backfill complete.");
    console.log(`Loans considered: ${result.loansConsidered}`);
    console.log(`Disbursement journals created: ${result.journalsCreated} (total principal ${result.totalPrincipalMinor})`);
    console.log(`Disbursement-fee journals created: ${result.feeJournalsCreated} (total fee ${result.totalFeeMinor})`);
    console.log(`Already posted (skipped): ${result.alreadyPosted}`);
    console.log(`Skipped, no settlement account: ${result.skippedNoSettlement}`);
    if (result.skippedNoMapping.length > 0) console.log(`Skipped, no product mapping: ${result.skippedNoMapping.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

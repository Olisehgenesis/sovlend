import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { SAVINGS_CASH_CODE, SAVINGS_LIABILITY_FALLBACK_CODE, SAVINGS_PRODUCT_LIABILITY_CODES } from "./backfill-ledger-bootstrap";

/**
 * Track 5 of the ledger backfill: savings transaction journals.
 *
 * Unlike loans, `SavingsTransaction` has only ~4,120 historical rows (vs. ~91k loan
 * transactions) and each row's `createdAt` was set from the real historical transaction date at
 * import time (see import-savings-transactions.ts), so this posts one journal PER TRANSACTION
 * rather than aggregating - full date precision, no simplification needed.
 *
 * There is no `SavingsProductAccountingMapping` model in the schema, so the liability GL account
 * per product is looked up by `SavingsProduct.shortName` against the same chart-of-accounts codes
 * identified for Track 1 (`SAVINGS_PRODUCT_LIABILITY_CODES`), falling back to the generic
 * "OTHER LIABILITIES - Savings Balances" account for any product without a dedicated one.
 *
 * Transaction types observed in production (`transactionType`, sign of `amountMinor`):
 *  - "Deposit" (positive): DEBIT Cash, CREDIT Savings Liability.
 *  - "Withdrawal" (negative): DEBIT Savings Liability, CREDIT Cash.
 *  - "Pay Charge" (negative): a fee deducted from the account - DEBIT Savings Liability, CREDIT
 *    generic Fee Income. No cash moves (the fee is retained by the institution from the balance).
 *  - "Waive Charge": no cash or balance impact ever actually collected - skipped, consistent with
 *    how loan-side charge waivers get no journal entry either.
 */

const FEE_INCOME_CODE = "30003"; // Fee Income (generic)

export type SavingsBackfillResult = Readonly<{
  transactionsConsidered: number;
  journalsCreated: number;
  alreadyPosted: number;
  skippedWaived: number;
  skippedNoOffice: number;
  skippedUnknownType: string[];
  totalDepositsMinor: bigint;
  totalWithdrawalsMinor: bigint;
  totalChargesMinor: bigint;
}>;

export async function backfillSavingsJournals(prisma: PrismaClient): Promise<SavingsBackfillResult> {
  const cashAccount = await prisma.ledgerAccount.findFirst({ where: { code: SAVINGS_CASH_CODE } });
  const feeIncomeAccount = await prisma.ledgerAccount.findFirst({ where: { code: FEE_INCOME_CODE } });
  const fallbackLiabilityAccount = await prisma.ledgerAccount.findFirst({ where: { code: SAVINGS_LIABILITY_FALLBACK_CODE } });
  if (!cashAccount || !feeIncomeAccount || !fallbackLiabilityAccount) {
    throw new Error("Chart-of-accounts is missing a required GL code for the savings backfill (cash, fee income, or fallback savings liability)");
  }

  const products = await prisma.savingsProduct.findMany({ select: { id: true, shortName: true } });
  const liabilityAccountByProductId = new Map<string, string>();
  for (const product of products) {
    const code = SAVINGS_PRODUCT_LIABILITY_CODES[product.shortName];
    if (!code) continue;
    const account = await prisma.ledgerAccount.findFirst({ where: { code } });
    if (account) liabilityAccountByProductId.set(product.id, account.id);
  }

  const transactions = await prisma.savingsTransaction.findMany({
    select: {
      id: true,
      transactionType: true,
      amountMinor: true,
      createdAt: true,
      savingsAccount: {
        select: {
          accountNumber: true,
          productId: true,
          client: { select: { officeId: true } },
          group: { select: { officeId: true } },
        },
      },
    },
  });

  let journalsCreated = 0;
  let alreadyPosted = 0;
  let skippedWaived = 0;
  let skippedNoOffice = 0;
  const skippedUnknownType = new Set<string>();
  let totalDepositsMinor = 0n;
  let totalWithdrawalsMinor = 0n;
  let totalChargesMinor = 0n;

  let processed = 0;
  for (const txn of transactions) {
    processed += 1;
    if (processed % 200 === 0) console.log(`... processed ${processed}/${transactions.length} savings transactions`);

    if (txn.transactionType === "Waive Charge") {
      skippedWaived += 1;
      continue;
    }

    const officeId = txn.savingsAccount.client?.officeId ?? txn.savingsAccount.group?.officeId;
    if (!officeId) {
      skippedNoOffice += 1;
      continue;
    }

    const liabilityAccountId =
      (txn.savingsAccount.productId ? liabilityAccountByProductId.get(txn.savingsAccount.productId) : undefined) ?? fallbackLiabilityAccount.id;
    const amount = txn.amountMinor < 0n ? -txn.amountMinor : txn.amountMinor;
    if (amount === 0n) continue;

    let lines: { accountId: string; direction: "DEBIT" | "CREDIT"; amountMinor: bigint; memo: string }[];
    if (txn.transactionType === "Deposit") {
      lines = [
        { accountId: cashAccount.id, direction: "DEBIT", amountMinor: amount, memo: cashAccount.name },
        { accountId: liabilityAccountId, direction: "CREDIT", amountMinor: amount, memo: txn.savingsAccount.accountNumber },
      ];
      totalDepositsMinor += amount;
    } else if (txn.transactionType === "Withdrawal") {
      lines = [
        { accountId: liabilityAccountId, direction: "DEBIT", amountMinor: amount, memo: txn.savingsAccount.accountNumber },
        { accountId: cashAccount.id, direction: "CREDIT", amountMinor: amount, memo: cashAccount.name },
      ];
      totalWithdrawalsMinor += amount;
    } else if (txn.transactionType === "Pay Charge") {
      lines = [
        { accountId: liabilityAccountId, direction: "DEBIT", amountMinor: amount, memo: txn.savingsAccount.accountNumber },
        { accountId: feeIncomeAccount.id, direction: "CREDIT", amountMinor: amount, memo: "Savings charge" },
      ];
      totalChargesMinor += amount;
    } else {
      skippedUnknownType.add(txn.transactionType);
      continue;
    }

    const key = `backfill:savings:${txn.id}`;
    const existing = await prisma.journal.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      alreadyPosted += 1;
      continue;
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          const journal = await tx.journal.create({
            data: {
              officeId,
              businessDate: txn.createdAt,
              referenceType: "SAVINGS_TRANSACTION_BACKFILL",
              referenceId: txn.id,
              narration: `${txn.transactionType} (historical backfill) ${txn.savingsAccount.accountNumber}`,
              idempotencyKey: key,
            },
          });
          await tx.journalLine.createMany({ data: lines.map((line) => ({ journalId: journal.id, ...line })) });
          await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
        },
        { timeout: 30_000, maxWait: 15_000 },
      );
      journalsCreated += 1;
    } catch (error) {
      console.error(`Savings journal failed for transaction ${txn.id} (${txn.savingsAccount.accountNumber}): ${error instanceof Error ? error.message : error}`);
    }
  }

  return {
    transactionsConsidered: transactions.length,
    journalsCreated,
    alreadyPosted,
    skippedWaived,
    skippedNoOffice,
    skippedUnknownType: [...skippedUnknownType],
    totalDepositsMinor,
    totalWithdrawalsMinor,
    totalChargesMinor,
  };
}

async function main() {
  try {
    const result = await backfillSavingsJournals(prisma);
    console.log("Savings journal backfill complete.");
    console.log(`Transactions considered: ${result.transactionsConsidered}`);
    console.log(`Journals created: ${result.journalsCreated}`);
    console.log(`Already posted (skipped): ${result.alreadyPosted}`);
    console.log(`Skipped, waived (no cash impact): ${result.skippedWaived}`);
    console.log(`Skipped, no office: ${result.skippedNoOffice}`);
    console.log(`Total deposits: ${result.totalDepositsMinor}, withdrawals: ${result.totalWithdrawalsMinor}, charges: ${result.totalChargesMinor}`);
    if (result.skippedUnknownType.length > 0) console.log(`Unknown transaction types skipped: ${result.skippedUnknownType.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { transactionTypeVariants } from "@/lib/loan-transaction-type-variants";

/**
 * Track 4 of the ledger backfill: write-off and recovery journals.
 *
 * Write-off: `Loan.principalWrittenOffMinor` (populated by the migration for every written-off
 * loan) is debited to the write-off expense account and credited out of principal receivable.
 * Interest/fees/penalties written off need no entry: under the live app's cash-basis method
 * (see backfill-ledger-collections.ts) they were never recognized as a receivable or as income
 * in the first place, so there is nothing on the books to reverse.
 *
 * Recovery: cash collected on an already-written-off loan (Fineract's `recoveryRepayment`
 * transactions) is standard practice to recognize as income when received, since the
 * receivable was already written off. Aggregated per loan from `LoanTransaction` (safe: this
 * only reads the append-only table, never mutates it) into DEBIT Cash / CREDIT "Value of Loans
 * Recovered".
 */

export type WriteOffBackfillResult = Readonly<{
  writtenOffLoansConsidered: number;
  writeOffJournalsCreated: number;
  recoveryJournalsCreated: number;
  alreadyPosted: number;
  skippedNoMapping: string[];
  skippedNoSettlement: number;
  skippedNoRecoveryAccount: number;
  totalWrittenOffMinor: bigint;
  totalRecoveredMinor: bigint;
}>;

const RECOVERY_INCOME_CODE = "30004"; // Value of Loans Recovered

export async function backfillWriteOffJournals(prisma: PrismaClient): Promise<WriteOffBackfillResult> {
  const recoveryAccount = await prisma.ledgerAccount.findFirst({ where: { code: RECOVERY_INCOME_CODE } });
  const settlementAccount = await prisma.settlementAccount.findFirst({ where: { name: "Cash", currencyCode: "UGX", active: true } });

  const writtenOffLoans = await prisma.loan.findMany({
    where: { writtenOffOn: { not: null } },
    select: {
      id: true,
      accountNumber: true,
      officeId: true,
      writtenOffOn: true,
      disbursedOn: true,
      principalWrittenOffMinor: true,
      product: { select: { accountingMapping: true } },
    },
  });

  let writeOffJournalsCreated = 0;
  let recoveryJournalsCreated = 0;
  let alreadyPosted = 0;
  let skippedNoSettlement = 0;
  let skippedNoRecoveryAccount = 0;
  const skippedNoMapping: string[] = [];
  let totalWrittenOffMinor = 0n;
  let totalRecoveredMinor = 0n;

  let processed = 0;
  for (const loan of writtenOffLoans) {
    processed += 1;
    if (processed % 50 === 0) console.log(`... processed ${processed}/${writtenOffLoans.length} written-off loans`);

    const mapping = loan.product.accountingMapping;
    if (!mapping) {
      skippedNoMapping.push(loan.accountNumber);
      continue;
    }
    if (!settlementAccount) {
      skippedNoSettlement += 1;
      continue;
    }
    const businessDate = loan.writtenOffOn ?? loan.disbursedOn!;

    // -- Write-off: DEBIT write-off expense, CREDIT principal receivable --
    if (loan.principalWrittenOffMinor > 0n && mapping.writeOffExpenseAccountId) {
      const key = `backfill:writeoff:${loan.id}`;
      const existing = await prisma.journal.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        alreadyPosted += 1;
      } else {
        try {
          await prisma.$transaction(
            async (tx) => {
              const journal = await tx.journal.create({
                data: {
                  officeId: loan.officeId,
                  businessDate,
                  referenceType: "LOAN_WRITE_OFF_BACKFILL",
                  referenceId: loan.id,
                  narration: `Written off (historical backfill) ${loan.accountNumber}`,
                  idempotencyKey: key,
                },
              });
              await tx.journalLine.createMany({
                data: [
                  { journalId: journal.id, accountId: mapping.writeOffExpenseAccountId!, direction: "DEBIT", amountMinor: loan.principalWrittenOffMinor, memo: loan.accountNumber },
                  { journalId: journal.id, accountId: mapping.principalReceivableAccountId, direction: "CREDIT", amountMinor: loan.principalWrittenOffMinor, memo: loan.accountNumber },
                ],
              });
              await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
            },
            { timeout: 30_000, maxWait: 15_000 },
          );
          writeOffJournalsCreated += 1;
          totalWrittenOffMinor += loan.principalWrittenOffMinor;
        } catch (error) {
          console.error(`Write-off journal failed for loan ${loan.accountNumber}: ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    // -- Recovery: DEBIT cash, CREDIT "Value of Loans Recovered" --
    if (!recoveryAccount) {
      skippedNoRecoveryAccount += 1;
    } else {
      const recoveryKey = `backfill:recovery:${loan.id}`;
      const existingRecovery = await prisma.journal.findUnique({ where: { idempotencyKey: recoveryKey } });
      if (existingRecovery) {
        alreadyPosted += 1;
      } else {
        const recoveryAgg = await prisma.loanTransaction.aggregate({
          where: { loanId: loan.id, transactionType: { in: transactionTypeVariants("RECOVERY_REPAYMENT") } },
          _sum: { denominationAmountMinor: true },
        });
        const recoveredAmount = recoveryAgg._sum.denominationAmountMinor ?? 0n;
        if (recoveredAmount > 0n) {
          try {
            await prisma.$transaction(
              async (tx) => {
                const journal = await tx.journal.create({
                  data: {
                    officeId: loan.officeId,
                    businessDate,
                    referenceType: "LOAN_RECOVERY_BACKFILL",
                    referenceId: loan.id,
                    narration: `Written-off loan recovery (historical backfill) ${loan.accountNumber}`,
                    idempotencyKey: recoveryKey,
                  },
                });
                await tx.journalLine.createMany({
                  data: [
                    { journalId: journal.id, accountId: settlementAccount.ledgerAccountId, direction: "DEBIT", amountMinor: recoveredAmount, memo: settlementAccount.name },
                    { journalId: journal.id, accountId: recoveryAccount.id, direction: "CREDIT", amountMinor: recoveredAmount, memo: loan.accountNumber },
                  ],
                });
                await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
              },
              { timeout: 30_000, maxWait: 15_000 },
            );
            recoveryJournalsCreated += 1;
            totalRecoveredMinor += recoveredAmount;
          } catch (error) {
            console.error(`Recovery journal failed for loan ${loan.accountNumber}: ${error instanceof Error ? error.message : error}`);
          }
        }
      }
    }
  }

  return {
    writtenOffLoansConsidered: writtenOffLoans.length,
    writeOffJournalsCreated,
    recoveryJournalsCreated,
    alreadyPosted,
    skippedNoMapping,
    skippedNoSettlement,
    skippedNoRecoveryAccount,
    totalWrittenOffMinor,
    totalRecoveredMinor,
  };
}

async function main() {
  try {
    const result = await backfillWriteOffJournals(prisma);
    console.log("Write-off/recovery journal backfill complete.");
    console.log(`Written-off loans considered: ${result.writtenOffLoansConsidered}`);
    console.log(`Write-off journals created: ${result.writeOffJournalsCreated} (total ${result.totalWrittenOffMinor})`);
    console.log(`Recovery journals created: ${result.recoveryJournalsCreated} (total ${result.totalRecoveredMinor})`);
    console.log(`Already posted (skipped): ${result.alreadyPosted}`);
    console.log(`Skipped, no settlement account: ${result.skippedNoSettlement}`);
    console.log(`Skipped, no recovery account: ${result.skippedNoRecoveryAccount}`);
    if (result.skippedNoMapping.length > 0) console.log(`Skipped, no product mapping: ${result.skippedNoMapping.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

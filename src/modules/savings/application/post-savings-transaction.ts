import type { PrismaClient } from "@prisma/client";

import { executeStandingOrderSweepsForSavingsDeposit } from "@/modules/lending/application/execute-standing-order-sweep";

import {
  recordSavingsTransactionInTransaction,
  type PostSavingsTransactionCommand,
} from "./record-savings-transaction";

function shouldTriggerStandingOrderSweep(command: PostSavingsTransactionCommand): boolean {
  return (
    command.transactionType === "DEPOSIT" &&
    command.postJournal !== false &&
    Boolean(command.settlementAccountId)
  );
}

async function maybeSweepDueLoansFromDeposit(
  prisma: PrismaClient,
  record: { id: string; savingsAccountId: string; createdAt?: Date | null },
  command: PostSavingsTransactionCommand,
): Promise<void> {
  if (!shouldTriggerStandingOrderSweep(command)) return;
  await executeStandingOrderSweepsForSavingsDeposit(prisma, {
    savingsAccountId: record.savingsAccountId,
    savingsTransactionId: record.id,
    now: command.businessDate ?? record.createdAt ?? new Date(),
  });
}

export async function postSavingsTransaction(
  prisma: PrismaClient,
  command: PostSavingsTransactionCommand,
) {
  if (command.amountMinor <= 0n) throw new Error("Transaction amount must be positive");

  const existing = await prisma.savingsTransaction.findUnique({
    where: { idempotencyKey: command.idempotencyKey },
  });
  if (existing) {
    await maybeSweepDueLoansFromDeposit(prisma, existing, command);
    return existing;
  }

  const account = await prisma.savingsAccount.findUnique({
    where: { id: command.savingsAccountId },
    select: { id: true, status: true },
  });
  if (!account) throw new Error("Savings account not found");
  if (account.status !== "ACTIVE") throw new Error("Savings account is not active");

  const record = await prisma.$transaction(
    async (transaction) => recordSavingsTransactionInTransaction(transaction, command),
    { isolationLevel: "Serializable" },
  );

  await maybeSweepDueLoansFromDeposit(prisma, record, command);
  return record;
}

export { recordSavingsTransactionInTransaction };
export type { PostSavingsTransactionCommand };

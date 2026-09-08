import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

export type PostSavingsTransactionCommand = Readonly<{
  savingsAccountId: string;
  actorUserId: string | null;
  transactionType: "DEPOSIT" | "WITHDRAWAL";
  amountMinor: bigint;
  settlementAccountId?: string;
  reason?: string;
  externalReference?: string;
  idempotencyKey: string;
}>;

type Tx = Prisma.TransactionClient;

export async function postSavingsTransaction(prisma: PrismaClient, command: PostSavingsTransactionCommand) {
  if (command.amountMinor <= 0n) throw new Error("Transaction amount must be positive");

  const existing = await prisma.savingsTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) return existing;

  const account = await prisma.savingsAccount.findUnique({
    where: { id: command.savingsAccountId },
    select: { id: true, status: true },
  });
  if (!account) throw new Error("Savings account not found");
  if (account.status !== "ACTIVE") throw new Error("Savings account is not active");

  return prisma.$transaction(
    async (transaction) => recordSavingsTransactionInTransaction(transaction, command),
    { isolationLevel: "Serializable" },
  );
}

export async function recordSavingsTransactionInTransaction(transaction: Tx, command: PostSavingsTransactionCommand) {
  const current = await transaction.savingsAccount.findUniqueOrThrow({
    where: { id: command.savingsAccountId },
    select: {
      id: true,
      accountNumber: true,
      clientId: true,
      groupId: true,
      currencyCode: true,
      status: true,
      client: { select: { organizationId: true } },
      group: { select: { organizationId: true } },
      transactions: { select: { amountMinor: true } },
    },
  });
  if (current.status !== "ACTIVE") throw new Error("Savings account is not active");

  const duplicate = await transaction.savingsTransaction.findUnique({
    where: { idempotencyKey: command.idempotencyKey },
  });
  if (duplicate) return duplicate;

  const organizationId = current.client?.organizationId ?? current.group?.organizationId;
  if (!organizationId) throw new Error("Savings account owner is not linked to an organization");

  const settlement = command.settlementAccountId
    ? await transaction.settlementAccount.findFirst({
        where: {
          id: command.settlementAccountId,
          organizationId,
          currencyCode: current.currencyCode,
          active: true,
        },
        select: { id: true, name: true },
      })
    : null;
  if (command.settlementAccountId && !settlement) {
    throw new Error("Selected settlement account is not available");
  }

  const currentBalance = current.transactions.reduce((sum, item) => sum + item.amountMinor, 0n);
  if (command.transactionType === "WITHDRAWAL" && command.amountMinor > currentBalance) {
    throw new Error("Withdrawal exceeds available balance");
  }

  const signedAmountMinor =
    command.transactionType === "DEPOSIT" ? command.amountMinor : -command.amountMinor;
  const record = await transaction.savingsTransaction.create({
    data: {
      savingsAccountId: current.id,
      transactionType: command.transactionType,
      amountMinor: signedAmountMinor,
      settlementAccountId: settlement?.id,
      recordedByUserId: command.actorUserId ?? undefined,
      reason: command.reason ?? null,
      externalReference: command.externalReference ?? null,
      idempotencyKey: command.idempotencyKey,
    },
  });

  const correlationId = randomUUID();
  const metadata = {
    savingsAccountId: current.id,
    accountNumber: current.accountNumber,
    ownerType: current.clientId ? "CLIENT" : "GROUP",
    ownerId: current.clientId ?? current.groupId,
    transactionType: command.transactionType,
    amountMinor: signedAmountMinor.toString(),
    absoluteAmountMinor: command.amountMinor.toString(),
    currencyCode: current.currencyCode,
    settlementAccountId: settlement?.id ?? null,
    settlementAccount: settlement?.name ?? null,
    reason: command.reason ?? null,
    externalReference: command.externalReference ?? null,
  };
  const action = "savings.transaction.recorded";
  const eventHash = createHash("sha256")
    .update(JSON.stringify({ correlationId, action, metadata }))
    .digest("hex");

  await transaction.auditEvent.create({
    data: {
      actorId: command.actorUserId ?? null,
      action,
      entityType: "SavingsAccount",
      entityId: current.id,
      correlationId,
      metadata,
      eventHash,
    },
  });
  await transaction.outboxEvent.create({
    data: {
      aggregateType: "SavingsAccount",
      aggregateId: current.id,
      eventType: action,
      payload: metadata,
    },
  });

  return record;
}

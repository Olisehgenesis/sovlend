import type { PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { assertPeriodOpen } from "@/modules/ledger/application/assert-period-open";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

import { recordSavingsTransactionInTransaction } from "./record-savings-transaction";
import { resolveSavingsLiabilityAccountId } from "./savings-ledger";

export type TransferSavingsToSavingsCommand = Readonly<{
  fromSavingsAccountId: string;
  toSavingsAccountId: string;
  actorUserId: string;
  amountMinor: bigint;
  businessDate: Date;
  externalReference?: string;
  idempotencyKey: string;
}>;

function withdrawalIdempotencyKey(key: string) {
  return `${key}:withdrawal`;
}

function depositIdempotencyKey(key: string) {
  return `${key}:deposit`;
}

/**
 * Moves money between two of a member's own savings sub-accounts (e.g. a personal account and a
 * group-linked account), with no cash leaving the institution and no settlement account involved.
 * Mirrors the accounting treatment of transferSavingsToLoan() in
 * @/modules/lending/application/post-repayment.ts: each leg is recorded as an ordinary
 * WITHDRAWAL/DEPOSIT SavingsTransaction (so both accounts' displayed balances update normally),
 * but the GL posting is handled here directly rather than by recordSavingsTransactionInTransaction
 * itself (postJournal:false on both legs) so that only ONE balanced journal is posted for the
 * whole transfer instead of two independent ones. When both accounts share the same savings
 * liability GL account (same product, or both mapped to the org default), no journal is posted at
 * all -- the movement nets to zero on that single account, so writing a journal that debits and
 * credits the same account would be a meaningless no-op entry.
 */
export async function transferSavingsToSavings(prisma: PrismaClient, command: TransferSavingsToSavingsCommand) {
  if (command.amountMinor <= 0n) throw new Error("Transfer amount must be positive");
  if (command.fromSavingsAccountId === command.toSavingsAccountId) {
    throw new Error("Choose two different savings accounts to transfer between");
  }

  const existingWithdrawal = await prisma.savingsTransaction.findUnique({
    where: { idempotencyKey: withdrawalIdempotencyKey(command.idempotencyKey) },
  });
  if (existingWithdrawal) return existingWithdrawal;

  const [from, to] = await Promise.all([
    prisma.savingsAccount.findUnique({
      where: { id: command.fromSavingsAccountId },
      select: { id: true, clientId: true, groupId: true, status: true, currencyCode: true },
    }),
    prisma.savingsAccount.findUnique({
      where: { id: command.toSavingsAccountId },
      select: { id: true, clientId: true, groupId: true, status: true, currencyCode: true },
    }),
  ]);
  if (!from || !to) throw new Error("Savings account not found");
  if (from.status !== "ACTIVE" || to.status !== "ACTIVE") throw new Error("Both savings accounts must be active");
  if (from.currencyCode !== to.currencyCode) throw new Error("Savings accounts must share the same currency");
  // A member-initiated internal transfer only ever moves money between a member's own accounts,
  // never between different members -- reject anything else outright rather than silently
  // allowing it.
  const sameOwner =
    (from.clientId != null && from.clientId === to.clientId) ||
    (from.groupId != null && from.groupId === to.groupId);
  if (!sameOwner) throw new Error("Both savings accounts must belong to the same client or group");

  const owner = await (from.clientId
    ? prisma.client.findUnique({ where: { id: from.clientId }, select: { organizationId: true, officeId: true } })
    : prisma.group.findUnique({ where: { id: from.groupId! }, select: { organizationId: true, officeId: true } }));
  if (!owner) throw new Error("Savings account owner not found");

  const authorization = new AuthorizationService(prisma);
  await authorization.assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.savingsTransact,
    organizationId: owner.organizationId,
    officeId: owner.officeId,
  });

  return prisma.$transaction(async (transaction) => {
    const duplicate = await transaction.savingsTransaction.findUnique({
      where: { idempotencyKey: withdrawalIdempotencyKey(command.idempotencyKey) },
    });
    if (duplicate) return duplicate;

    const [fromAccount, toAccount] = await Promise.all([
      transaction.savingsAccount.findUniqueOrThrow({
        where: { id: command.fromSavingsAccountId },
        select: {
          id: true,
          accountNumber: true,
          productId: true,
          transactions: { select: { amountMinor: true } },
          product: { select: { shortName: true } },
        },
      }),
      transaction.savingsAccount.findUniqueOrThrow({
        where: { id: command.toSavingsAccountId },
        select: { id: true, accountNumber: true, productId: true, product: { select: { shortName: true } } },
      }),
    ]);
    const balance = fromAccount.transactions.reduce((sum, item) => sum + item.amountMinor, 0n);
    if (command.amountMinor > balance) throw new Error("Transfer exceeds the available savings balance");

    const [fromLiabilityAccountId, toLiabilityAccountId] = await Promise.all([
      resolveSavingsLiabilityAccountId(transaction, {
        organizationId: owner.organizationId,
        savingsProductId: fromAccount.productId,
        savingsProductShortName: fromAccount.product?.shortName ?? null,
      }),
      resolveSavingsLiabilityAccountId(transaction, {
        organizationId: owner.organizationId,
        savingsProductId: toAccount.productId,
        savingsProductShortName: toAccount.product?.shortName ?? null,
      }),
    ]);

    if (fromLiabilityAccountId !== toLiabilityAccountId) {
      await assertPeriodOpen(transaction, { officeId: owner.officeId, businessDate: command.businessDate });
      const journalLines = [
        { accountId: fromLiabilityAccountId, direction: "DEBIT" as const, amountMinor: command.amountMinor, memo: fromAccount.accountNumber, currencyCode: from.currencyCode },
        { accountId: toLiabilityAccountId, direction: "CREDIT" as const, amountMinor: command.amountMinor, memo: toAccount.accountNumber, currencyCode: from.currencyCode },
      ];
      assertBalancedJournal(journalLines);
      const journal = await transaction.journal.create({
        data: {
          officeId: owner.officeId,
          businessDate: command.businessDate,
          referenceType: "SAVINGS_TRANSFER",
          referenceId: command.idempotencyKey,
          narration: `Transfer ${fromAccount.accountNumber} -> ${toAccount.accountNumber}`,
          idempotencyKey: `journal:${command.idempotencyKey}`,
        },
      });
      await transaction.journalLine.createMany({
        data: journalLines.map((line) => ({ journalId: journal.id, ...line })),
      });
      await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
    }

    const reason = command.externalReference ?? `Transfer to ${toAccount.accountNumber}`;
    const withdrawal = await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: fromAccount.id,
      actorUserId: command.actorUserId,
      transactionType: "WITHDRAWAL",
      amountMinor: command.amountMinor,
      reason,
      idempotencyKey: withdrawalIdempotencyKey(command.idempotencyKey),
      businessDate: command.businessDate,
      postJournal: false,
    });
    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: toAccount.id,
      actorUserId: command.actorUserId,
      transactionType: "DEPOSIT",
      amountMinor: command.amountMinor,
      reason: command.externalReference ?? `Transfer from ${fromAccount.accountNumber}`,
      idempotencyKey: depositIdempotencyKey(command.idempotencyKey),
      businessDate: command.businessDate,
      postJournal: false,
    });

    return withdrawal;
  }, { isolationLevel: "Serializable" });
}

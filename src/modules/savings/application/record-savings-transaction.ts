import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { assertPeriodOpen } from "@/modules/ledger/application/assert-period-open";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

import { resolveSavingsLiabilityAccountId } from "./savings-ledger";

export type PostSavingsTransactionCommand = Readonly<{
  savingsAccountId: string;
  actorUserId: string | null;
  transactionType: "DEPOSIT" | "WITHDRAWAL";
  amountMinor: bigint;
  settlementAccountId?: string;
  reason?: string;
  externalReference?: string;
  idempotencyKey: string;
  businessDate?: Date;
  // Set false when the caller already posts the equivalent ledger entry itself and this call is
  // purely a client-facing balance mirror -- e.g. disburse-loan.ts crediting a savings account
  // (its own journal already credits the savings liability account for the net proceeds) or
  // execute-standing-order-sweep.ts's withdrawal mirror (postRepayment's journal already debits
  // the liability account via the sweep's dedicated settlement account). Posting a second journal
  // in those cases would double-count the liability movement. Defaults to true, matching the
  // teller/API-recorded deposit and withdrawal flows this fixes (see Problem 1 in the accounting
  // audit: these previously never posted a journal at all).
  postJournal?: boolean;
}>;

export type Tx = Prisma.TransactionClient;

export async function recordSavingsTransactionInTransaction(transaction: Tx, command: PostSavingsTransactionCommand) {
  const current = await transaction.savingsAccount.findUniqueOrThrow({
    where: { id: command.savingsAccountId },
    select: {
      id: true,
      accountNumber: true,
      clientId: true,
      groupId: true,
      productId: true,
      currencyCode: true,
      status: true,
      client: { select: { organizationId: true, officeId: true } },
      group: { select: { organizationId: true, officeId: true } },
      product: { select: { shortName: true } },
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
  const officeId = current.client?.officeId ?? current.group?.officeId;

  const settlement = command.settlementAccountId
    ? await transaction.settlementAccount.findFirst({
        where: {
          id: command.settlementAccountId,
          organizationId,
          currencyCode: current.currencyCode,
          active: true,
        },
        select: { id: true, name: true, ledgerAccountId: true },
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

  const shouldPostJournal = command.postJournal !== false && Boolean(settlement);
  if (shouldPostJournal) {
    if (!officeId) {
      throw new Error("Savings account owner has no office; cannot post a ledger journal");
    }
    const businessDate = command.businessDate ?? new Date();
    await assertPeriodOpen(transaction, { officeId, businessDate });
    const savingsLiabilityAccountId = await resolveSavingsLiabilityAccountId(transaction, {
      organizationId,
      savingsProductId: current.productId,
      savingsProductShortName: current.product?.shortName ?? null,
    });

    const journalLines =
      command.transactionType === "DEPOSIT"
        ? [
            { accountId: settlement!.ledgerAccountId, direction: "DEBIT" as const, amountMinor: command.amountMinor, memo: settlement!.name },
            { accountId: savingsLiabilityAccountId, direction: "CREDIT" as const, amountMinor: command.amountMinor, memo: current.accountNumber },
          ]
        : [
            { accountId: savingsLiabilityAccountId, direction: "DEBIT" as const, amountMinor: command.amountMinor, memo: current.accountNumber },
            { accountId: settlement!.ledgerAccountId, direction: "CREDIT" as const, amountMinor: command.amountMinor, memo: settlement!.name },
          ];
    assertBalancedJournal(journalLines.map((line) => ({ ...line, currencyCode: current.currencyCode })));

    const journal = await transaction.journal.create({
      data: {
        officeId,
        businessDate,
        referenceType: "SAVINGS_TRANSACTION",
        referenceId: record.id,
        narration: `${command.transactionType === "DEPOSIT" ? "Deposit" : "Withdrawal"} ${current.accountNumber}`,
        idempotencyKey: `journal:${command.idempotencyKey}`,
      },
    });
    await transaction.journalLine.createMany({
      data: journalLines.map((line) => ({ journalId: journal.id, ...line })),
    });
    await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
  }

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
    journalPosted: shouldPostJournal,
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

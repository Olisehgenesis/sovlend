import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

import { assertBalancedJournal } from "../domain/journal";
import { assertPeriodOpen } from "./assert-period-open";

export type JournalEntryLineCommand = Readonly<{
  ledgerAccountId: string;
  amountMinor: bigint;
}>;

export type JournalEntryPaymentDetails = Readonly<{
  paymentType: string | null;
  accountNumber: string | null;
  checkNumber: string | null;
  receiptNumber: string | null;
  bankNumber: string | null;
}>;

export type RecordJournalEntryCommand = Readonly<{
  organizationId: string;
  officeId: string;
  actorUserId: string;
  currencyCode: string;
  businessDate: Date;
  referenceNumber: string | null;
  narration: string;
  debits: readonly JournalEntryLineCommand[];
  credits: readonly JournalEntryLineCommand[];
  paymentDetails: JournalEntryPaymentDetails | null;
  idempotencyKey: string;
}>;

/**
 * Records a free-form manual journal entry -- iLend/Fineract's "Add Journal Entries": the poster
 * picks any number of GL accounts to debit and any number to credit (not restricted to a single
 * income/expense-vs-settlement-account pair like recordManualJournalEntry()), as long as the
 * total debits equal the total credits for the chosen currency. Used for corrections, transfers
 * between GL accounts, and postings that don't fit the Record income/expense shortcuts.
 */
export async function recordJournalEntry(prisma: PrismaClient, command: RecordJournalEntryCommand) {
  if (command.debits.length === 0) throw new Error("At least one debit line is required");
  if (command.credits.length === 0) throw new Error("At least one credit line is required");
  for (const line of [...command.debits, ...command.credits]) {
    if (line.amountMinor <= 0n) throw new Error("Every line amount must be greater than zero");
  }

  const idempotencyKey = `journal:${command.idempotencyKey}`;
  const existing = await prisma.journal.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const office = await prisma.office.findFirst({ where: { id: command.officeId, organizationId: command.organizationId } });
  if (!office) throw new Error("Office not found for this organization");

  const accountIds = [...new Set([...command.debits, ...command.credits].map((line) => line.ledgerAccountId))];
  const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: accountIds } } });
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  for (const accountId of accountIds) {
    const account = accountsById.get(accountId);
    if (!account) throw new Error("One of the selected GL accounts could not be found");
    if (!account.active || account.usage !== "DETAIL" || !account.manualEntriesAllowed) {
      throw new Error(`"${account.name}" is not an active detail account enabled for manual entries`);
    }
    if (account.currencyCode !== command.currencyCode) {
      throw new Error(`"${account.name}" is denominated in ${account.currencyCode}, not the selected ${command.currencyCode}`);
    }
  }

  const totalDebitMinor = command.debits.reduce((sum, line) => sum + line.amountMinor, 0n);
  const totalCreditMinor = command.credits.reduce((sum, line) => sum + line.amountMinor, 0n);

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.ledgerPost,
    organizationId: command.organizationId,
    officeId: command.officeId,
    amountMinor: totalDebitMinor,
    currencyCode: command.currencyCode,
  });
  await assertPeriodOpen(prisma, { officeId: command.officeId, businessDate: command.businessDate });

  const journalLines = [
    ...command.debits.map((line) => ({
      accountId: line.ledgerAccountId,
      direction: "DEBIT" as const,
      amountMinor: line.amountMinor,
      memo: accountsById.get(line.ledgerAccountId)!.name,
    })),
    ...command.credits.map((line) => ({
      accountId: line.ledgerAccountId,
      direction: "CREDIT" as const,
      amountMinor: line.amountMinor,
      memo: accountsById.get(line.ledgerAccountId)!.name,
    })),
  ];
  assertBalancedJournal(journalLines.map((line) => ({ ...line, currencyCode: command.currencyCode })));

  return prisma.$transaction(async (transaction) => {
    const journal = await transaction.journal.create({
      data: {
        officeId: command.officeId,
        businessDate: command.businessDate,
        referenceType: "MANUAL_JOURNAL_ENTRY",
        referenceId: command.referenceNumber,
        narration: command.narration.trim() || "Manual journal entry",
        idempotencyKey,
      },
    });

    await transaction.journalLine.createMany({ data: journalLines.map((line) => ({ journalId: journal.id, ...line })) });
    await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

    const correlationId = randomUUID();
    const metadata = {
      journalId: journal.id,
      currencyCode: command.currencyCode,
      referenceNumber: command.referenceNumber,
      totalDebitMinor: totalDebitMinor.toString(),
      totalCreditMinor: totalCreditMinor.toString(),
      debits: command.debits.map((line) => ({ ledgerAccountId: line.ledgerAccountId, amountMinor: line.amountMinor.toString() })),
      credits: command.credits.map((line) => ({ ledgerAccountId: line.ledgerAccountId, amountMinor: line.amountMinor.toString() })),
      paymentDetails: command.paymentDetails,
      narration: command.narration.trim(),
    };
    const eventHash = createHash("sha256")
      .update(JSON.stringify({ correlationId, action: "ledger.journal_entry_posted", metadata }))
      .digest("hex");
    await transaction.auditEvent.create({
      data: {
        actorId: command.actorUserId,
        action: "ledger.journal_entry_posted",
        entityType: "Journal",
        entityId: journal.id,
        correlationId,
        metadata,
        eventHash,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        aggregateType: "Journal",
        aggregateId: journal.id,
        eventType: "ledger.journal_entry_posted",
        payload: metadata,
      },
    });

    return journal;
  });
}

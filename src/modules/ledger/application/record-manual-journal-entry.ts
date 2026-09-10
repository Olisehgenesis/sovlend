import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

import { assertBalancedJournal } from "../domain/journal";
import { assertPeriodOpen } from "./assert-period-open";

export type ManualJournalEntryType = "INCOME" | "EXPENSE";

export type ManualJournalEntryCommand = Readonly<{
  organizationId: string;
  officeId: string;
  actorUserId: string;
  entryType: ManualJournalEntryType;
  /** The REVENUE account (for INCOME) or EXPENSE account (for EXPENSE) being posted to. */
  ledgerAccountId: string;
  /** The cash/bank/mobile-money account the money actually moved through. */
  settlementAccountId: string;
  amountMinor: bigint;
  businessDate: Date;
  narration: string;
  idempotencyKey: string;
}>;

/**
 * Records a manual, non-loan, non-savings accounting entry -- e.g. "Office Rent Expense paid
 * from Bank" or "Donation received into Cash". Mirrors the two-line balanced-journal pattern
 * used by disburseLoan()/transferSavingsToLoan() (see disburse-loan.ts, post-repayment.ts) but
 * has no loan/savings side effects: it only ever touches Journal/JournalLine plus the audit
 * trail. INCOME debits the settlement account and credits the income account; EXPENSE debits
 * the expense account and credits the settlement account.
 */
export async function recordManualJournalEntry(prisma: PrismaClient, command: ManualJournalEntryCommand) {
  if (command.amountMinor <= 0n) throw new Error("Amount must be greater than zero");
  if (!command.narration.trim()) throw new Error("A narration/description is required");

  const idempotencyKey = `journal:${command.idempotencyKey}`;
  const existing = await prisma.journal.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const office = await prisma.office.findFirst({ where: { id: command.officeId, organizationId: command.organizationId } });
  if (!office) throw new Error("Office not found for this organization");

  const settlementAccount = await prisma.settlementAccount.findFirst({
    where: { id: command.settlementAccountId, organizationId: command.organizationId, active: true },
    include: { ledgerAccount: true },
  });
  if (!settlementAccount) throw new Error("Settlement account not found or inactive");

  const expectedType = command.entryType === "INCOME" ? "REVENUE" : "EXPENSE";
  const ledgerAccount = await prisma.ledgerAccount.findFirst({
    where: { id: command.ledgerAccountId, active: true, usage: "DETAIL", type: expectedType, manualEntriesAllowed: true },
  });
  if (!ledgerAccount) {
    throw new Error(
      `Select an active ${command.entryType === "INCOME" ? "income" : "expense"} account that is enabled for manual entries`,
    );
  }
  if (ledgerAccount.currencyCode !== settlementAccount.currencyCode) {
    throw new Error("The income/expense account and the settlement account must share a currency");
  }

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.ledgerPost,
    organizationId: command.organizationId,
    officeId: command.officeId,
    amountMinor: command.amountMinor,
    currencyCode: settlementAccount.currencyCode,
  });
  await assertPeriodOpen(prisma, { officeId: command.officeId, businessDate: command.businessDate });

  return prisma.$transaction(async (transaction) => {
    const journal = await transaction.journal.create({
      data: {
        officeId: command.officeId,
        businessDate: command.businessDate,
        referenceType: command.entryType === "INCOME" ? "MANUAL_INCOME" : "MANUAL_EXPENSE",
        narration: command.narration.trim(),
        idempotencyKey,
      },
    });

    const journalLines =
      command.entryType === "INCOME"
        ? [
            { accountId: settlementAccount.ledgerAccountId, direction: "DEBIT" as const, amountMinor: command.amountMinor, memo: settlementAccount.name },
            { accountId: ledgerAccount.id, direction: "CREDIT" as const, amountMinor: command.amountMinor, memo: ledgerAccount.name },
          ]
        : [
            { accountId: ledgerAccount.id, direction: "DEBIT" as const, amountMinor: command.amountMinor, memo: ledgerAccount.name },
            { accountId: settlementAccount.ledgerAccountId, direction: "CREDIT" as const, amountMinor: command.amountMinor, memo: settlementAccount.name },
          ];
    assertBalancedJournal(journalLines.map((line) => ({ ...line, currencyCode: settlementAccount.currencyCode })));
    await transaction.journalLine.createMany({ data: journalLines.map((line) => ({ journalId: journal.id, ...line })) });
    await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

    const correlationId = randomUUID();
    const metadata = {
      journalId: journal.id,
      entryType: command.entryType,
      ledgerAccountId: ledgerAccount.id,
      ledgerAccountName: ledgerAccount.name,
      settlementAccountId: settlementAccount.id,
      settlementAccountName: settlementAccount.name,
      amountMinor: command.amountMinor.toString(),
      narration: command.narration.trim(),
    };
    const eventHash = createHash("sha256")
      .update(JSON.stringify({ correlationId, action: "ledger.manual_entry_posted", metadata }))
      .digest("hex");
    await transaction.auditEvent.create({
      data: {
        actorId: command.actorUserId,
        action: "ledger.manual_entry_posted",
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
        eventType: "ledger.manual_entry_posted",
        payload: metadata,
      },
    });

    return journal;
  });
}

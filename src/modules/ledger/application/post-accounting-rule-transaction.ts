import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

import { assertBalancedJournal } from "../domain/journal";
import { assertPeriodOpen } from "./assert-period-open";

export type PostAccountingRuleTransactionCommand = Readonly<{
  organizationId: string;
  officeId: string;
  actorUserId: string;
  ruleId: string;
  amountMinor: bigint;
  businessDate: Date;
  narration: string;
  idempotencyKey: string;
  /** Required only when the rule's DEBIT side allows more than one account. */
  debitAccountId?: string;
  /** Required only when the rule's CREDIT side allows more than one account. */
  creditAccountId?: string;
}>;

/**
 * Posts a two-sided journal entry using a predefined AccountingRule ("Frequent Postings" in
 * iLend/Mifos terms) -- e.g. selecting "Petty Cash Replenishment" and just entering an amount,
 * office, and date, instead of picking raw accounts each time (contrast with
 * recordManualJournalEntry(), which is income/expense-specific and always uses a settlement
 * account on one side). When a rule's side lists a single account it's used automatically;
 * when it lists several, the caller must supply which one via debitAccountId/creditAccountId.
 */
export async function postAccountingRuleTransaction(prisma: PrismaClient, command: PostAccountingRuleTransactionCommand) {
  if (command.amountMinor <= 0n) throw new Error("Amount must be greater than zero");
  if (!command.narration.trim()) throw new Error("A narration/description is required");

  const idempotencyKey = `journal:${command.idempotencyKey}`;
  const existing = await prisma.journal.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const office = await prisma.office.findFirst({ where: { id: command.officeId, organizationId: command.organizationId } });
  if (!office) throw new Error("Office not found for this organization");

  const rule = await prisma.accountingRule.findFirst({
    where: { id: command.ruleId, organizationId: command.organizationId, active: true },
    include: { accounts: { include: { account: true } } },
  });
  if (!rule) throw new Error("Accounting rule not found or inactive");
  if (rule.officeId && rule.officeId !== command.officeId) {
    throw new Error("This accounting rule is restricted to a different office");
  }

  const debitOptions = rule.accounts.filter((entry) => entry.side === "DEBIT");
  const creditOptions = rule.accounts.filter((entry) => entry.side === "CREDIT");

  function resolveSide(options: typeof debitOptions, chosenAccountId: string | undefined, sideLabel: string) {
    if (options.length === 0) throw new Error(`Accounting rule has no ${sideLabel} account configured`);
    if (options.length === 1) return options[0]!.account;
    if (!chosenAccountId) throw new Error(`Select a ${sideLabel} account for this rule`);
    const match = options.find((entry) => entry.accountId === chosenAccountId);
    if (!match) throw new Error(`Selected ${sideLabel} account is not allowed by this rule`);
    return match.account;
  }

  const debitAccount = resolveSide(debitOptions, command.debitAccountId, "debit");
  const creditAccount = resolveSide(creditOptions, command.creditAccountId, "credit");
  if (debitAccount.currencyCode !== creditAccount.currencyCode) {
    throw new Error("The selected debit and credit accounts must share a currency");
  }

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.ledgerPost,
    organizationId: command.organizationId,
    officeId: command.officeId,
    amountMinor: command.amountMinor,
    currencyCode: debitAccount.currencyCode,
  });
  await assertPeriodOpen(prisma, { officeId: command.officeId, businessDate: command.businessDate });

  return prisma.$transaction(async (transaction) => {
    const journal = await transaction.journal.create({
      data: {
        officeId: command.officeId,
        businessDate: command.businessDate,
        referenceType: "MANUAL_FREQUENT_POSTING",
        referenceId: rule.id,
        narration: command.narration.trim(),
        idempotencyKey,
      },
    });

    const journalLines = [
      { accountId: debitAccount.id, direction: "DEBIT" as const, amountMinor: command.amountMinor, memo: debitAccount.name },
      { accountId: creditAccount.id, direction: "CREDIT" as const, amountMinor: command.amountMinor, memo: creditAccount.name },
    ];
    assertBalancedJournal(journalLines.map((line) => ({ ...line, currencyCode: debitAccount.currencyCode })));
    await transaction.journalLine.createMany({ data: journalLines.map((line) => ({ journalId: journal.id, ...line })) });
    await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

    const correlationId = randomUUID();
    const metadata = {
      journalId: journal.id,
      ruleId: rule.id,
      ruleName: rule.name,
      debitAccountId: debitAccount.id,
      debitAccountName: debitAccount.name,
      creditAccountId: creditAccount.id,
      creditAccountName: creditAccount.name,
      amountMinor: command.amountMinor.toString(),
      narration: command.narration.trim(),
    };
    const eventHash = createHash("sha256")
      .update(JSON.stringify({ correlationId, action: "ledger.frequent_posting_posted", metadata }))
      .digest("hex");
    await transaction.auditEvent.create({
      data: {
        actorId: command.actorUserId,
        action: "ledger.frequent_posting_posted",
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
        eventType: "ledger.frequent_posting_posted",
        payload: metadata,
      },
    });

    return journal;
  });
}

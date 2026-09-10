import type { Prisma, PrismaClient } from "@prisma/client";

type RulePrisma = PrismaClient | Prisma.TransactionClient;

export type AccountingRuleSide = "DEBIT" | "CREDIT";

export type AccountingRuleAccountSelection = Readonly<{ accountId: string; side: AccountingRuleSide }>;

export type SaveAccountingRuleCommand = Readonly<{
  /** Present only when updating an existing rule; absent for a new one. */
  ruleId?: string;
  organizationId: string;
  /** Null means the rule is usable from any office in the organization. */
  officeId: string | null;
  name: string;
  description: string | null;
  active: boolean;
  accounts: readonly AccountingRuleAccountSelection[];
}>;

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Validates the debit/credit account selection shared by create and update: at least one
 * account per side, no account used on both sides, and every selected account must be an
 * active, manual-entry-enabled DETAIL account sharing a single currency (mirrors the
 * validation recordManualJournalEntry() applies to its two accounts, generalized to N).
 */
async function validateAccountSelection(prisma: RulePrisma, accounts: readonly AccountingRuleAccountSelection[]) {
  const debitAccountIds = dedupe(accounts.filter((account) => account.side === "DEBIT").map((account) => account.accountId));
  const creditAccountIds = dedupe(accounts.filter((account) => account.side === "CREDIT").map((account) => account.accountId));
  if (debitAccountIds.length === 0) throw new Error("Select at least one debit account");
  if (creditAccountIds.length === 0) throw new Error("Select at least one credit account");
  const overlap = debitAccountIds.filter((id) => creditAccountIds.includes(id));
  if (overlap.length > 0) throw new Error("An account cannot be used on both the debit and credit side of the same rule");

  const allAccountIds = [...debitAccountIds, ...creditAccountIds];
  const foundAccounts = await prisma.ledgerAccount.findMany({
    where: { id: { in: allAccountIds }, active: true, usage: "DETAIL", manualEntriesAllowed: true },
    select: { id: true, currencyCode: true },
  });
  if (foundAccounts.length !== allAccountIds.length) {
    throw new Error("Select active accounts that are enabled for manual entries");
  }
  const currencies = new Set(foundAccounts.map((account) => account.currencyCode));
  if (currencies.size > 1) throw new Error("All accounts in a rule must share the same currency");

  return { debitAccountIds, creditAccountIds };
}

/**
 * Creates or updates a named debit/credit posting template ("Accounting Rule" in iLend/Mifos
 * terms) -- e.g. "Petty Cash Replenishment: Dr Office Supplies Expense, Cr Cash" -- that
 * postAccountingRuleTransaction() (Frequent Postings) later uses to post a two-sided journal
 * without the poster having to pick raw accounts each time. Rules with more than one account
 * on a side let the poster choose from that restricted list at posting time.
 */
export async function saveAccountingRule(prisma: PrismaClient, command: SaveAccountingRuleCommand) {
  const name = command.name.trim();
  if (!name) throw new Error("A rule name is required");
  const description = command.description?.trim() || null;

  if (command.officeId) {
    const office = await prisma.office.findFirst({ where: { id: command.officeId, organizationId: command.organizationId } });
    if (!office) throw new Error("Office not found for this organization");
  }

  const existingName = await prisma.accountingRule.findFirst({
    where: {
      organizationId: command.organizationId,
      name: { equals: name, mode: "insensitive" },
      ...(command.ruleId ? { id: { not: command.ruleId } } : {}),
    },
  });
  if (existingName) throw new Error(`An accounting rule named "${name}" already exists`);

  const { debitAccountIds, creditAccountIds } = await validateAccountSelection(prisma, command.accounts);

  const accountRows = [
    ...debitAccountIds.map((accountId) => ({ accountId, side: "DEBIT" as const })),
    ...creditAccountIds.map((accountId) => ({ accountId, side: "CREDIT" as const })),
  ];

  return prisma.$transaction(async (tx) => {
    if (command.ruleId) {
      const current = await tx.accountingRule.findFirst({ where: { id: command.ruleId, organizationId: command.organizationId } });
      if (!current) throw new Error("Accounting rule not found for this organization");

      const rule = await tx.accountingRule.update({
        where: { id: command.ruleId },
        data: { officeId: command.officeId, name, description, active: command.active },
      });
      await tx.accountingRuleAccount.deleteMany({ where: { ruleId: rule.id } });
      await tx.accountingRuleAccount.createMany({ data: accountRows.map((row) => ({ ruleId: rule.id, ...row })) });
      return rule;
    }

    const rule = await tx.accountingRule.create({
      data: { organizationId: command.organizationId, officeId: command.officeId, name, description, active: command.active },
    });
    await tx.accountingRuleAccount.createMany({ data: accountRows.map((row) => ({ ruleId: rule.id, ...row })) });
    return rule;
  });
}

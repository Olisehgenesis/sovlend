import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { postAccountingRuleTransaction } from "./post-accounting-rule-transaction";

const cashAccount = { id: "cash-1", name: "Cash", currencyCode: "UGX" };
const expenseAccount = { id: "expense-1", name: "Office Supplies Expense", currencyCode: "UGX" };

function buildRule(overrides: { officeId?: string | null; active?: boolean; accounts?: Array<{ accountId: string; side: "DEBIT" | "CREDIT"; account: typeof cashAccount }> } = {}) {
  return {
    id: "rule-1",
    organizationId: "org-1",
    name: "Petty Cash Replenishment",
    officeId: overrides.officeId ?? null,
    active: overrides.active ?? true,
    accounts:
      overrides.accounts ??
      ([
        { accountId: "expense-1", side: "DEBIT", account: expenseAccount },
        { accountId: "cash-1", side: "CREDIT", account: cashAccount },
      ] as const),
  };
}

function buildPrisma(overrides: { existingJournal?: unknown; office?: unknown; rule?: unknown } = {}) {
  const journalCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "journal-1", ...args.data }));
  const journalLineCreateMany = vi.fn(async () => ({ count: 2 }));
  const journalUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "journal-1", ...args.data }));
  const auditEventCreate = vi.fn(async () => ({}));
  const outboxEventCreate = vi.fn(async () => ({}));
  const accountingClosureFindFirst = vi.fn(async () => null);

  const tx = {
    journal: { create: journalCreate, update: journalUpdate },
    journalLine: { createMany: journalLineCreateMany },
    auditEvent: { create: auditEventCreate },
    outboxEvent: { create: outboxEventCreate },
  };

  const prisma = {
    journal: { findUnique: vi.fn(async () => overrides.existingJournal ?? null) },
    office: { findFirst: vi.fn(async () => ("office" in overrides ? overrides.office : { id: "office-1", organizationId: "org-1" })) },
    accountingRule: { findFirst: vi.fn(async () => ("rule" in overrides ? overrides.rule : buildRule())) },
    accountingClosure: { findFirst: accountingClosureFindFirst },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;

  return { prisma, journalCreate, journalLineCreateMany, journalUpdate, auditEventCreate, outboxEventCreate };
}

const baseCommand = {
  organizationId: "org-1",
  officeId: "office-1",
  actorUserId: "user-1",
  ruleId: "rule-1",
  amountMinor: 25_000n,
  businessDate: new Date("2026-09-09T00:00:00.000Z"),
  narration: "Petty cash top-up",
  idempotencyKey: "idem-1",
};

describe("postAccountingRuleTransaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts a two-line journal using the rule's fixed debit/credit accounts", async () => {
    const { prisma, journalLineCreateMany, journalUpdate } = buildPrisma();
    const journal = await postAccountingRuleTransaction(prisma, baseCommand);

    expect(journalLineCreateMany).toHaveBeenCalledWith({
      data: [
        { journalId: "journal-1", accountId: "expense-1", direction: "DEBIT", amountMinor: 25_000n, memo: "Office Supplies Expense" },
        { journalId: "journal-1", accountId: "cash-1", direction: "CREDIT", amountMinor: 25_000n, memo: "Cash" },
      ],
    });
    expect(journalUpdate).toHaveBeenCalledWith({ where: { id: "journal-1" }, data: { status: "POSTED", postedAt: expect.any(Date) } });
    expect(journal).toMatchObject({ referenceType: "MANUAL_FREQUENT_POSTING", referenceId: "rule-1" });
  });

  it("returns the existing journal without posting new lines on an idempotent replay", async () => {
    const existing = { id: "journal-existing" };
    const { prisma, journalCreate, journalLineCreateMany } = buildPrisma({ existingJournal: existing });
    const result = await postAccountingRuleTransaction(prisma, baseCommand);

    expect(result).toBe(existing);
    expect(journalCreate).not.toHaveBeenCalled();
    expect(journalLineCreateMany).not.toHaveBeenCalled();
  });

  it("resolves a restricted-list debit side using the caller's chosen account", async () => {
    const secondExpense = { id: "expense-2", name: "Travel Expense", currencyCode: "UGX" };
    const rule = buildRule({
      accounts: [
        { accountId: "expense-1", side: "DEBIT", account: expenseAccount },
        { accountId: "expense-2", side: "DEBIT", account: secondExpense },
        { accountId: "cash-1", side: "CREDIT", account: cashAccount },
      ],
    });
    const { prisma, journalLineCreateMany } = buildPrisma({ rule });
    await postAccountingRuleTransaction(prisma, { ...baseCommand, debitAccountId: "expense-2" });

    expect(journalLineCreateMany).toHaveBeenCalledWith({
      data: [
        { journalId: "journal-1", accountId: "expense-2", direction: "DEBIT", amountMinor: 25_000n, memo: "Travel Expense" },
        { journalId: "journal-1", accountId: "cash-1", direction: "CREDIT", amountMinor: 25_000n, memo: "Cash" },
      ],
    });
  });

  it("rejects a restricted-list side when the caller does not choose an account", async () => {
    const secondExpense = { id: "expense-2", name: "Travel Expense", currencyCode: "UGX" };
    const rule = buildRule({
      accounts: [
        { accountId: "expense-1", side: "DEBIT", account: expenseAccount },
        { accountId: "expense-2", side: "DEBIT", account: secondExpense },
        { accountId: "cash-1", side: "CREDIT", account: cashAccount },
      ],
    });
    const { prisma } = buildPrisma({ rule });
    await expect(postAccountingRuleTransaction(prisma, baseCommand)).rejects.toThrow("Select a debit account");
  });

  it("rejects a debit account that is not part of the rule's allowed list", async () => {
    const secondExpense = { id: "expense-2", name: "Travel Expense", currencyCode: "UGX" };
    const rule = buildRule({
      accounts: [
        { accountId: "expense-1", side: "DEBIT", account: expenseAccount },
        { accountId: "expense-2", side: "DEBIT", account: secondExpense },
        { accountId: "cash-1", side: "CREDIT", account: cashAccount },
      ],
    });
    const { prisma } = buildPrisma({ rule });
    await expect(postAccountingRuleTransaction(prisma, { ...baseCommand, debitAccountId: "not-in-rule" })).rejects.toThrow("not allowed by this rule");
  });

  it("rejects an inactive or missing rule", async () => {
    const { prisma } = buildPrisma({ rule: null });
    await expect(postAccountingRuleTransaction(prisma, baseCommand)).rejects.toThrow("not found or inactive");
  });

  it("rejects when the rule is restricted to a different office", async () => {
    const { prisma } = buildPrisma({ rule: buildRule({ officeId: "office-other" }) });
    await expect(postAccountingRuleTransaction(prisma, baseCommand)).rejects.toThrow("restricted to a different office");
  });

  it("rejects a zero or negative amount", async () => {
    const { prisma } = buildPrisma();
    await expect(postAccountingRuleTransaction(prisma, { ...baseCommand, amountMinor: 0n })).rejects.toThrow("greater than zero");
  });

  it("rejects a blank narration", async () => {
    const { prisma } = buildPrisma();
    await expect(postAccountingRuleTransaction(prisma, { ...baseCommand, narration: "   " })).rejects.toThrow("narration/description is required");
  });

  it("rejects when the office does not belong to the organization", async () => {
    const { prisma } = buildPrisma({ office: null });
    await expect(postAccountingRuleTransaction(prisma, baseCommand)).rejects.toThrow("Office not found");
  });

  it("enforces the period-open check for the office/businessDate", async () => {
    const { prisma } = buildPrisma();
    (prisma.accountingClosure.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ closingDate: new Date("2026-09-10T00:00:00.000Z") });
    await expect(postAccountingRuleTransaction(prisma, baseCommand)).rejects.toThrow("closed on or before");
  });
});

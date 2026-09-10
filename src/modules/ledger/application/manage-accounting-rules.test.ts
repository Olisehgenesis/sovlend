import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveAccountingRule } from "./manage-accounting-rules";

function buildPrisma(overrides: {
  office?: unknown;
  existingName?: unknown;
  ledgerAccounts?: Array<{ id: string; currencyCode: string }>;
  existingRule?: unknown;
} = {}) {
  const ruleCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "rule-1", ...args.data }));
  const ruleUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ id: args.where.id, ...args.data }));
  const ruleAccountCreateMany = vi.fn(async () => ({ count: 2 }));
  const ruleAccountDeleteMany = vi.fn(async () => ({ count: 0 }));

  const tx = {
    accountingRule: {
      create: ruleCreate,
      update: ruleUpdate,
      findFirst: vi.fn(async () => ("existingRule" in overrides ? overrides.existingRule : { id: "rule-1", organizationId: "org-1" })),
    },
    accountingRuleAccount: { createMany: ruleAccountCreateMany, deleteMany: ruleAccountDeleteMany },
  };

  const prisma = {
    office: { findFirst: vi.fn(async () => ("office" in overrides ? overrides.office : { id: "office-1", organizationId: "org-1" })) },
    accountingRule: { findFirst: vi.fn(async () => overrides.existingName ?? null) },
    ledgerAccount: {
      findMany: vi.fn(
        async () =>
          overrides.ledgerAccounts ?? [
            { id: "expense-1", currencyCode: "UGX" },
            { id: "cash-1", currencyCode: "UGX" },
          ],
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;

  return { prisma, ruleCreate, ruleUpdate, ruleAccountCreateMany, ruleAccountDeleteMany };
}

const baseCommand = {
  organizationId: "org-1",
  officeId: null,
  name: "Petty Cash Replenishment",
  description: "Dr Office Supplies Expense, Cr Cash",
  active: true,
  accounts: [
    { accountId: "expense-1", side: "DEBIT" as const },
    { accountId: "cash-1", side: "CREDIT" as const },
  ],
};

describe("saveAccountingRule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new rule with its debit/credit accounts", async () => {
    const { prisma, ruleCreate, ruleAccountCreateMany } = buildPrisma();
    const rule = await saveAccountingRule(prisma, baseCommand);

    expect(ruleCreate).toHaveBeenCalledWith({
      data: { organizationId: "org-1", officeId: null, name: "Petty Cash Replenishment", description: "Dr Office Supplies Expense, Cr Cash", active: true },
    });
    expect(ruleAccountCreateMany).toHaveBeenCalledWith({
      data: [
        { ruleId: "rule-1", accountId: "expense-1", side: "DEBIT" },
        { ruleId: "rule-1", accountId: "cash-1", side: "CREDIT" },
      ],
    });
    expect(rule).toMatchObject({ id: "rule-1" });
  });

  it("updates an existing rule, replacing its accounts", async () => {
    const { prisma, ruleUpdate, ruleAccountDeleteMany, ruleAccountCreateMany } = buildPrisma({
      existingRule: { id: "rule-1", organizationId: "org-1" },
    });
    await saveAccountingRule(prisma, { ...baseCommand, ruleId: "rule-1", active: false });

    expect(ruleUpdate).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: { officeId: null, name: "Petty Cash Replenishment", description: "Dr Office Supplies Expense, Cr Cash", active: false },
    });
    expect(ruleAccountDeleteMany).toHaveBeenCalledWith({ where: { ruleId: "rule-1" } });
    expect(ruleAccountCreateMany).toHaveBeenCalled();
  });

  it("rejects when updating a rule that does not belong to the organization", async () => {
    const { prisma } = buildPrisma({ existingRule: null });
    await expect(saveAccountingRule(prisma, { ...baseCommand, ruleId: "rule-1" })).rejects.toThrow("not found");
  });

  it("rejects a blank name", async () => {
    const { prisma } = buildPrisma();
    await expect(saveAccountingRule(prisma, { ...baseCommand, name: "   " })).rejects.toThrow("name is required");
  });

  it("rejects a duplicate name within the organization", async () => {
    const { prisma } = buildPrisma({ existingName: { id: "rule-existing" } });
    await expect(saveAccountingRule(prisma, baseCommand)).rejects.toThrow("already exists");
  });

  it("rejects when no debit account is selected", async () => {
    const { prisma } = buildPrisma();
    await expect(
      saveAccountingRule(prisma, { ...baseCommand, accounts: [{ accountId: "cash-1", side: "CREDIT" as const }] }),
    ).rejects.toThrow("debit account");
  });

  it("rejects when no credit account is selected", async () => {
    const { prisma } = buildPrisma();
    await expect(
      saveAccountingRule(prisma, { ...baseCommand, accounts: [{ accountId: "expense-1", side: "DEBIT" as const }] }),
    ).rejects.toThrow("credit account");
  });

  it("rejects when the same account is used on both sides", async () => {
    const { prisma } = buildPrisma();
    await expect(
      saveAccountingRule(prisma, {
        ...baseCommand,
        accounts: [
          { accountId: "cash-1", side: "DEBIT" as const },
          { accountId: "cash-1", side: "CREDIT" as const },
        ],
      }),
    ).rejects.toThrow("both the debit and credit side");
  });

  it("rejects when a selected account is inactive, header, or manual-entries-disallowed", async () => {
    const { prisma } = buildPrisma({ ledgerAccounts: [{ id: "expense-1", currencyCode: "UGX" }] });
    await expect(saveAccountingRule(prisma, baseCommand)).rejects.toThrow("enabled for manual entries");
  });

  it("rejects when the selected accounts do not share a currency", async () => {
    const { prisma } = buildPrisma({
      ledgerAccounts: [
        { id: "expense-1", currencyCode: "UGX" },
        { id: "cash-1", currencyCode: "USD" },
      ],
    });
    await expect(saveAccountingRule(prisma, baseCommand)).rejects.toThrow("must share the same currency");
  });

  it("rejects when the office does not belong to the organization", async () => {
    const { prisma } = buildPrisma({ office: null });
    await expect(saveAccountingRule(prisma, { ...baseCommand, officeId: "office-1" })).rejects.toThrow("Office not found");
  });
});

import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { recordManualJournalEntry } from "./record-manual-journal-entry";

function buildPrisma(overrides: {
  existingJournal?: unknown;
  office?: unknown;
  settlementAccount?: unknown;
  ledgerAccount?: unknown;
}) {
  const journalCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "journal-1", ...args.data }));
  const journalLineCreateMany = vi.fn(async () => ({ count: 2 }));
  const journalUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "journal-1", ...args.data }));
  const auditEventCreate = vi.fn(async () => ({}));
  const outboxEventCreate = vi.fn(async () => ({}));

  const tx = {
    journal: { create: journalCreate, update: journalUpdate },
    journalLine: { createMany: journalLineCreateMany },
    auditEvent: { create: auditEventCreate },
    outboxEvent: { create: outboxEventCreate },
  };

  const prisma = {
    journal: { findUnique: vi.fn(async () => overrides.existingJournal ?? null) },
    office: { findFirst: vi.fn(async () => overrides.office ?? { id: "office-1", organizationId: "org-1" }) },
    settlementAccount: {
      findFirst: vi.fn(
        async () =>
          overrides.settlementAccount ?? {
            id: "settlement-1",
            organizationId: "org-1",
            active: true,
            name: "Cash",
            currencyCode: "UGX",
            ledgerAccountId: "cash-account-1",
          },
      ),
    },
    ledgerAccount: {
      findFirst: vi.fn(
        async () =>
          overrides.ledgerAccount ?? {
            id: "revenue-account-1",
            name: "Donations",
            currencyCode: "UGX",
          },
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;

  return { prisma, journalCreate, journalLineCreateMany, journalUpdate, auditEventCreate, outboxEventCreate };
}

const baseCommand = {
  organizationId: "org-1",
  officeId: "office-1",
  actorUserId: "user-1",
  amountMinor: 50_000n,
  businessDate: new Date("2026-09-09T00:00:00.000Z"),
  narration: "Donation received",
  idempotencyKey: "idem-1",
};

describe("recordManualJournalEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("debits the settlement account and credits the income account for an INCOME entry", async () => {
    const { prisma, journalLineCreateMany, journalUpdate } = buildPrisma({});
    await recordManualJournalEntry(prisma, { ...baseCommand, entryType: "INCOME", ledgerAccountId: "revenue-account-1", settlementAccountId: "settlement-1" });

    expect(journalLineCreateMany).toHaveBeenCalledWith({
      data: [
        { journalId: "journal-1", accountId: "cash-account-1", direction: "DEBIT", amountMinor: 50_000n, memo: "Cash" },
        { journalId: "journal-1", accountId: "revenue-account-1", direction: "CREDIT", amountMinor: 50_000n, memo: "Donations" },
      ],
    });
    expect(journalUpdate).toHaveBeenCalledWith({ where: { id: "journal-1" }, data: { status: "POSTED", postedAt: expect.any(Date) } });
  });

  it("debits the expense account and credits the settlement account for an EXPENSE entry", async () => {
    const { prisma, journalLineCreateMany } = buildPrisma({
      ledgerAccount: { id: "expense-account-1", name: "Office Rent", currencyCode: "UGX" },
    });
    await recordManualJournalEntry(prisma, { ...baseCommand, entryType: "EXPENSE", ledgerAccountId: "expense-account-1", settlementAccountId: "settlement-1" });

    expect(journalLineCreateMany).toHaveBeenCalledWith({
      data: [
        { journalId: "journal-1", accountId: "expense-account-1", direction: "DEBIT", amountMinor: 50_000n, memo: "Office Rent" },
        { journalId: "journal-1", accountId: "cash-account-1", direction: "CREDIT", amountMinor: 50_000n, memo: "Cash" },
      ],
    });
  });

  it("returns the existing journal without posting new lines on an idempotent replay", async () => {
    const existing = { id: "journal-existing" };
    const { prisma, journalLineCreateMany, journalCreate } = buildPrisma({ existingJournal: existing });
    const result = await recordManualJournalEntry(prisma, { ...baseCommand, entryType: "INCOME", ledgerAccountId: "revenue-account-1", settlementAccountId: "settlement-1" });

    expect(result).toBe(existing);
    expect(journalCreate).not.toHaveBeenCalled();
    expect(journalLineCreateMany).not.toHaveBeenCalled();
  });

  it("rejects when the ledger account and settlement account currencies differ", async () => {
    const { prisma } = buildPrisma({ ledgerAccount: { id: "revenue-account-1", name: "Donations", currencyCode: "USD" } });
    await expect(
      recordManualJournalEntry(prisma, { ...baseCommand, entryType: "INCOME", ledgerAccountId: "revenue-account-1", settlementAccountId: "settlement-1" }),
    ).rejects.toThrow("must share a currency");
  });

  it("rejects a zero or negative amount", async () => {
    const { prisma } = buildPrisma({});
    await expect(
      recordManualJournalEntry(prisma, { ...baseCommand, amountMinor: 0n, entryType: "INCOME", ledgerAccountId: "revenue-account-1", settlementAccountId: "settlement-1" }),
    ).rejects.toThrow("greater than zero");
  });
});

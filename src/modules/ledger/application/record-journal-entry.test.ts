import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { recordJournalEntry } from "./record-journal-entry";

const CASH = { id: "cash-1", name: "Cash", type: "ASSET", currencyCode: "UGX", active: true, usage: "DETAIL", manualEntriesAllowed: true };
const BANK = { id: "bank-1", name: "Bank", type: "ASSET", currencyCode: "UGX", active: true, usage: "DETAIL", manualEntriesAllowed: true };
const SUSPENSE = { id: "suspense-1", name: "Suspense", type: "LIABILITY", currencyCode: "UGX", active: true, usage: "DETAIL", manualEntriesAllowed: true };

function buildPrisma(overrides: { existingJournal?: unknown; office?: unknown; accounts?: unknown[]; closureDate?: Date | null }) {
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
    ledgerAccount: { findMany: vi.fn(async () => overrides.accounts ?? [CASH, BANK, SUSPENSE]) },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
    accountingClosure: {
      findFirst: vi.fn(async () => (overrides.closureDate ? { closingDate: overrides.closureDate } : null)),
    },
  } as unknown as PrismaClient;

  return { prisma, journalCreate, journalLineCreateMany, journalUpdate, auditEventCreate, outboxEventCreate };
}

const baseCommand = {
  organizationId: "org-1",
  officeId: "office-1",
  actorUserId: "user-1",
  currencyCode: "UGX",
  businessDate: new Date("2026-09-09T00:00:00.000Z"),
  referenceNumber: "REF-100",
  narration: "Correcting entry",
  paymentDetails: null,
  idempotencyKey: "idem-1",
};

describe("recordJournalEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts a single debit against a single credit line", async () => {
    const { prisma, journalLineCreateMany, journalUpdate } = buildPrisma({});
    await recordJournalEntry(prisma, {
      ...baseCommand,
      debits: [{ ledgerAccountId: "cash-1", amountMinor: 10_000n }],
      credits: [{ ledgerAccountId: "suspense-1", amountMinor: 10_000n }],
    });

    expect(journalLineCreateMany).toHaveBeenCalledWith({
      data: [
        { journalId: "journal-1", accountId: "cash-1", direction: "DEBIT", amountMinor: 10_000n, memo: "Cash" },
        { journalId: "journal-1", accountId: "suspense-1", direction: "CREDIT", amountMinor: 10_000n, memo: "Suspense" },
      ],
    });
    expect(journalUpdate).toHaveBeenCalledWith({ where: { id: "journal-1" }, data: { status: "POSTED", postedAt: expect.any(Date) } });
  });

  it("posts multiple debit lines against multiple credit lines that net to the same total", async () => {
    const { prisma, journalLineCreateMany } = buildPrisma({});
    await recordJournalEntry(prisma, {
      ...baseCommand,
      debits: [
        { ledgerAccountId: "cash-1", amountMinor: 6_000n },
        { ledgerAccountId: "bank-1", amountMinor: 4_000n },
      ],
      credits: [{ ledgerAccountId: "suspense-1", amountMinor: 10_000n }],
    });

    expect(journalLineCreateMany).toHaveBeenCalledWith({
      data: [
        { journalId: "journal-1", accountId: "cash-1", direction: "DEBIT", amountMinor: 6_000n, memo: "Cash" },
        { journalId: "journal-1", accountId: "bank-1", direction: "DEBIT", amountMinor: 4_000n, memo: "Bank" },
        { journalId: "journal-1", accountId: "suspense-1", direction: "CREDIT", amountMinor: 10_000n, memo: "Suspense" },
      ],
    });
  });

  it("rejects when debits and credits don't balance", async () => {
    const { prisma } = buildPrisma({});
    await expect(
      recordJournalEntry(prisma, {
        ...baseCommand,
        debits: [{ ledgerAccountId: "cash-1", amountMinor: 10_000n }],
        credits: [{ ledgerAccountId: "suspense-1", amountMinor: 9_000n }],
      }),
    ).rejects.toThrow(/not balanced/i);
  });

  it("rejects with no debit lines", async () => {
    const { prisma } = buildPrisma({});
    await expect(
      recordJournalEntry(prisma, { ...baseCommand, debits: [], credits: [{ ledgerAccountId: "suspense-1", amountMinor: 10_000n }] }),
    ).rejects.toThrow("debit line is required");
  });

  it("rejects with no credit lines", async () => {
    const { prisma } = buildPrisma({});
    await expect(
      recordJournalEntry(prisma, { ...baseCommand, debits: [{ ledgerAccountId: "cash-1", amountMinor: 10_000n }], credits: [] }),
    ).rejects.toThrow("credit line is required");
  });

  it("rejects a zero or negative line amount", async () => {
    const { prisma } = buildPrisma({});
    await expect(
      recordJournalEntry(prisma, {
        ...baseCommand,
        debits: [{ ledgerAccountId: "cash-1", amountMinor: 0n }],
        credits: [{ ledgerAccountId: "suspense-1", amountMinor: 0n }],
      }),
    ).rejects.toThrow("greater than zero");
  });

  it("rejects an account that isn't enabled for manual entries", async () => {
    const { prisma } = buildPrisma({ accounts: [CASH, { ...SUSPENSE, manualEntriesAllowed: false }] });
    await expect(
      recordJournalEntry(prisma, {
        ...baseCommand,
        debits: [{ ledgerAccountId: "cash-1", amountMinor: 10_000n }],
        credits: [{ ledgerAccountId: "suspense-1", amountMinor: 10_000n }],
      }),
    ).rejects.toThrow(/manual entries/);
  });

  it("rejects an account in a different currency than the entry", async () => {
    const { prisma } = buildPrisma({ accounts: [CASH, { ...SUSPENSE, currencyCode: "USD" }] });
    await expect(
      recordJournalEntry(prisma, {
        ...baseCommand,
        debits: [{ ledgerAccountId: "cash-1", amountMinor: 10_000n }],
        credits: [{ ledgerAccountId: "suspense-1", amountMinor: 10_000n }],
      }),
    ).rejects.toThrow(/USD/);
  });

  it("returns the existing journal without posting new lines on an idempotent replay", async () => {
    const existing = { id: "journal-existing" };
    const { prisma, journalCreate, journalLineCreateMany } = buildPrisma({ existingJournal: existing });
    const result = await recordJournalEntry(prisma, {
      ...baseCommand,
      debits: [{ ledgerAccountId: "cash-1", amountMinor: 10_000n }],
      credits: [{ ledgerAccountId: "suspense-1", amountMinor: 10_000n }],
    });

    expect(result).toBe(existing);
    expect(journalCreate).not.toHaveBeenCalled();
    expect(journalLineCreateMany).not.toHaveBeenCalled();
  });

  it("rejects when the office's accounting period is closed on/before the businessDate", async () => {
    const { prisma } = buildPrisma({ closureDate: new Date("2026-09-09T00:00:00.000Z") });
    await expect(
      recordJournalEntry(prisma, {
        ...baseCommand,
        debits: [{ ledgerAccountId: "cash-1", amountMinor: 10_000n }],
        credits: [{ ledgerAccountId: "suspense-1", amountMinor: 10_000n }],
      }),
    ).rejects.toThrow(/accounting period/i);
  });
});

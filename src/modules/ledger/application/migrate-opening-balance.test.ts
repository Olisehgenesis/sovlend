import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { migrateOpeningBalance } from "./migrate-opening-balance";

type MockOptions = Readonly<{
  existingMigration?: unknown;
  defaults?: { openingBalanceEquityAccountId: string | null } | null;
  closureDate?: Date | null;
  ledgerAccount?: { id: string; name: string } | null;
}>;

function buildPrisma(options: MockOptions = {}) {
  const captures: Record<string, unknown> = {
    journalCreateData: null,
    journalLines: [],
    migrationCreateData: null,
    auditEventData: null,
    outboxEventData: null,
  };

  const tx = {
    journal: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.journalCreateData = data;
        return { id: "journal-1" };
      }),
      update: vi.fn(async () => ({ id: "journal-1", status: "POSTED" })),
    },
    journalLine: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        captures.journalLines = data;
        return { count: data.length };
      }),
    },
    openingBalanceMigration: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.migrationCreateData = data;
        return { id: "migration-1", ...data };
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.auditEventData = data;
        return data;
      }),
    },
    outboxEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.outboxEventData = data;
        return data;
      }),
    },
  };

  const defaults =
    options.defaults === null ? null : options.defaults ?? { openingBalanceEquityAccountId: "ledger-opening-balance-equity" };
  const ledgerAccount = options.ledgerAccount === null ? null : options.ledgerAccount ?? { id: "ledger-cash", name: "Cash on Hand" };

  const prisma = {
    office: { findFirst: vi.fn(async () => ({ id: "office-1", organizationId: "org-1", name: "Head Office" })) },
    ledgerAccount: { findFirst: vi.fn(async () => ledgerAccount) },
    openingBalanceMigration: {
      findUnique: vi.fn(async () => options.existingMigration ?? null),
    },
    openingBalanceAccountingDefaults: { findUnique: vi.fn(async () => defaults) },
    accountingClosure: { findFirst: vi.fn(async () => (options.closureDate ? { closingDate: options.closureDate } : null)) },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;

  return { prisma, captures };
}

const baseCommand = {
  organizationId: "org-1",
  officeId: "office-1",
  actorUserId: "user-1",
  ledgerAccountId: "ledger-cash",
  asOfDate: new Date("2026-01-01T00:00:00.000Z"),
  direction: "DEBIT" as const,
  amountMinor: 500_000n,
};

describe("migrateOpeningBalance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts a debit opening balance against the equity contra account", async () => {
    const { prisma, captures } = buildPrisma();

    const result = await migrateOpeningBalance(prisma, baseCommand);

    expect(result.alreadyMigrated).toBe(false);
    expect(result.migration.amountMinor).toBe(500_000n);
    expect(captures.journalCreateData).toMatchObject({
      officeId: "office-1",
      referenceType: "OPENING_BALANCE",
      idempotencyKey: "opening-balance:office-1:ledger-cash",
    });
    expect(captures.journalLines).toEqual([
      { journalId: "journal-1", accountId: "ledger-cash", direction: "DEBIT", amountMinor: 500_000n, memo: "Opening balance" },
      { journalId: "journal-1", accountId: "ledger-opening-balance-equity", direction: "CREDIT", amountMinor: 500_000n, memo: "Opening balance equity" },
    ]);
  });

  it("posts a credit opening balance with the contra debited instead", async () => {
    const { prisma, captures } = buildPrisma();

    await migrateOpeningBalance(prisma, { ...baseCommand, direction: "CREDIT", ledgerAccountId: "ledger-savings-liability" });

    expect(captures.journalLines).toEqual([
      { journalId: "journal-1", accountId: "ledger-savings-liability", direction: "CREDIT", amountMinor: 500_000n, memo: "Opening balance" },
      { journalId: "journal-1", accountId: "ledger-opening-balance-equity", direction: "DEBIT", amountMinor: 500_000n, memo: "Opening balance equity" },
    ]);
  });

  it("is idempotent for the same office and GL account", async () => {
    const existingMigration = {
      id: "migration-existing",
      ledgerAccountId: "ledger-cash",
      officeId: "office-1",
      asOfDate: new Date("2025-12-01T00:00:00.000Z"),
      direction: "DEBIT",
      amountMinor: 100_000n,
      journalId: "journal-existing",
    };
    const { prisma, captures } = buildPrisma({ existingMigration });

    const result = await migrateOpeningBalance(prisma, baseCommand);

    expect(result.alreadyMigrated).toBe(true);
    expect(result.migration).toEqual(existingMigration);
    expect(captures.journalCreateData).toBeNull();
  });

  it("throws when the opening balance equity account is not configured", async () => {
    const { prisma } = buildPrisma({ defaults: null });

    await expect(migrateOpeningBalance(prisma, baseCommand)).rejects.toThrow(
      "Opening balance equity account is not configured",
    );
  });

  it("rejects migrating the equity account against itself", async () => {
    const { prisma } = buildPrisma({ defaults: { openingBalanceEquityAccountId: "ledger-cash" } });

    await expect(migrateOpeningBalance(prisma, baseCommand)).rejects.toThrow(
      "cannot be migrated against itself",
    );
  });

  it("rejects a non-positive amount", async () => {
    const { prisma } = buildPrisma();

    await expect(migrateOpeningBalance(prisma, { ...baseCommand, amountMinor: 0n })).rejects.toThrow(
      "must be positive",
    );
  });

  it("throws when the GL account does not exist or is not an active detail account", async () => {
    const { prisma } = buildPrisma({ ledgerAccount: null });

    await expect(migrateOpeningBalance(prisma, baseCommand)).rejects.toThrow(
      "GL account not found or is not an active detail account",
    );
  });

  it("rejects posting when the office's accounting period is closed on/before the asOfDate", async () => {
    const { prisma, captures } = buildPrisma({ closureDate: new Date("2026-01-01T00:00:00.000Z") });

    await expect(migrateOpeningBalance(prisma, baseCommand)).rejects.toThrow(/accounting period/i);
    expect(captures.journalCreateData).toBeNull();
  });
});

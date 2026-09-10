import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { transferSavingsToSavings } from "./transfer-savings";

type SavingsAccountRow = {
  id: string;
  accountNumber: string;
  clientId: string | null;
  groupId: string | null;
  productId: string;
  status: string;
  currencyCode: string;
  client: { organizationId: string; officeId: string } | null;
  group: { organizationId: string; officeId: string } | null;
  product: { shortName: string };
  transactions: { amountMinor: bigint }[];
};

function buildAccount(overrides: Partial<SavingsAccountRow>): SavingsAccountRow {
  return {
    id: "savings-from",
    accountNumber: "SV-0001",
    clientId: "client-1",
    groupId: null,
    productId: "product-msa",
    status: "ACTIVE",
    currencyCode: "UGX",
    client: { organizationId: "org-1", officeId: "office-1" },
    group: null,
    product: { shortName: "MSA" },
    transactions: [{ amountMinor: 5_000n }],
    ...overrides,
  };
}

function buildPrismaMock(options?: { fromAccount?: SavingsAccountRow; toAccount?: SavingsAccountRow }) {
  const fromAccount = options?.fromAccount ?? buildAccount({ id: "savings-from", accountNumber: "SV-0001" });
  const toAccount =
    options?.toAccount ?? buildAccount({ id: "savings-to", accountNumber: "SV-0002", product: { shortName: "cs" }, transactions: [] });
  const accountsById: Record<string, SavingsAccountRow> = {
    [fromAccount.id]: fromAccount,
    [toAccount.id]: toAccount,
  };

  const captures: { journalLines: unknown[]; savingsTransactions: unknown[]; journalCreateCalls: unknown[] } = {
    journalLines: [],
    savingsTransactions: [],
    journalCreateCalls: [],
  };

  // Different products resolve to different ledger accounts, keyed off the legacy hardcoded
  // GL-code table (MSA -> ML-001, cs -> CA-004) -- see savings-ledger.ts.
  const ledgerAccountsByCode: Record<string, string> = {
    "ML-001": "ledger-msa-liability",
    "CA-004": "ledger-cs-liability",
    "20004": "ledger-fallback-liability",
  };

  const transaction = {
    savingsAccount: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => accountsById[where.id]),
    },
    savingsTransaction: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.savingsTransactions.push(data);
        return { id: `savings-tx-${captures.savingsTransactions.length}`, ...data };
      }),
    },
    journal: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        captures.journalCreateCalls.push(args.data);
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
    savingsProductAccountingMapping: { findUnique: vi.fn(async () => null) },
    savingsAccountingDefaults: { findUnique: vi.fn(async () => null) },
    ledgerAccount: {
      findFirst: vi.fn(async ({ where }: { where: { code: string } }) => {
        const id = ledgerAccountsByCode[where.code];
        return id ? { id } : null;
      }),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    outboxEvent: { create: vi.fn(async () => ({})) },
    accountingClosure: { findFirst: vi.fn(async () => null) },
  };

  const prisma = {
    savingsTransaction: { findUnique: vi.fn(async () => null) },
    savingsAccount: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => accountsById[where.id] ?? null),
    },
    client: { findUnique: vi.fn(async () => ({ organizationId: "org-1", officeId: "office-1" })) },
    group: { findUnique: vi.fn(async () => ({ organizationId: "org-1", officeId: "office-1" })) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;

  return { prisma, captures, fromAccount, toAccount };
}

describe("transferSavingsToSavings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts one balanced journal and mirrors both legs when the accounts use different liability accounts", async () => {
    const { prisma, captures } = buildPrismaMock();

    const result = await transferSavingsToSavings(prisma, {
      fromSavingsAccountId: "savings-from",
      toSavingsAccountId: "savings-to",
      actorUserId: "operator-1",
      amountMinor: 1_000n,
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "transfer-1",
    });

    expect(captures.journalCreateCalls).toHaveLength(1);
    expect(captures.journalLines).toEqual([
      { journalId: "journal-1", accountId: "ledger-msa-liability", direction: "DEBIT", amountMinor: 1_000n, memo: "SV-0001", currencyCode: "UGX" },
      { journalId: "journal-1", accountId: "ledger-cs-liability", direction: "CREDIT", amountMinor: 1_000n, memo: "SV-0002", currencyCode: "UGX" },
    ]);

    expect(captures.savingsTransactions).toHaveLength(2);
    const [withdrawal, deposit] = captures.savingsTransactions as Array<{ transactionType: string; amountMinor: bigint; idempotencyKey: string }>;
    expect(withdrawal.transactionType).toBe("WITHDRAWAL");
    expect(withdrawal.amountMinor).toBe(-1_000n);
    expect(withdrawal.idempotencyKey).toBe("transfer-1:withdrawal");
    expect(deposit.transactionType).toBe("DEPOSIT");
    expect(deposit.amountMinor).toBe(1_000n);
    expect(deposit.idempotencyKey).toBe("transfer-1:deposit");
    expect(result).toMatchObject({ transactionType: "WITHDRAWAL" });
  });

  it("skips the journal entirely when both accounts resolve to the same liability account", async () => {
    const toAccount = buildAccount({ id: "savings-to", accountNumber: "SV-0002", product: { shortName: "MSA" }, transactions: [] });
    const { prisma, captures } = buildPrismaMock({ toAccount });

    await transferSavingsToSavings(prisma, {
      fromSavingsAccountId: "savings-from",
      toSavingsAccountId: "savings-to",
      actorUserId: "operator-1",
      amountMinor: 1_000n,
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "transfer-2",
    });

    expect(captures.journalCreateCalls).toHaveLength(0);
    expect(captures.journalLines).toHaveLength(0);
    expect(captures.savingsTransactions).toHaveLength(2);
  });

  it("rejects a transfer that exceeds the available savings balance", async () => {
    const { prisma } = buildPrismaMock();

    await expect(
      transferSavingsToSavings(prisma, {
        fromSavingsAccountId: "savings-from",
        toSavingsAccountId: "savings-to",
        actorUserId: "operator-1",
        amountMinor: 10_000n,
        businessDate: new Date("2026-09-09T00:00:00.000Z"),
        idempotencyKey: "transfer-3",
      }),
    ).rejects.toThrow("Transfer exceeds the available savings balance");
  });

  it("rejects when the two accounts belong to different owners", async () => {
    const toAccount = buildAccount({
      id: "savings-to",
      accountNumber: "SV-0002",
      clientId: "someone-else",
      client: { organizationId: "org-1", officeId: "office-1" },
      transactions: [],
    });
    const { prisma } = buildPrismaMock({ toAccount });

    await expect(
      transferSavingsToSavings(prisma, {
        fromSavingsAccountId: "savings-from",
        toSavingsAccountId: "savings-to",
        actorUserId: "operator-1",
        amountMinor: 500n,
        businessDate: new Date("2026-09-09T00:00:00.000Z"),
        idempotencyKey: "transfer-4",
      }),
    ).rejects.toThrow("Both savings accounts must belong to the same client or group");
  });

  it("rejects a transfer between accounts in different currencies", async () => {
    const toAccount = buildAccount({ id: "savings-to", accountNumber: "SV-0002", currencyCode: "KES", transactions: [] });
    const { prisma } = buildPrismaMock({ toAccount });

    await expect(
      transferSavingsToSavings(prisma, {
        fromSavingsAccountId: "savings-from",
        toSavingsAccountId: "savings-to",
        actorUserId: "operator-1",
        amountMinor: 500n,
        businessDate: new Date("2026-09-09T00:00:00.000Z"),
        idempotencyKey: "transfer-5",
      }),
    ).rejects.toThrow("Savings accounts must share the same currency");
  });

  it("rejects a transfer when either account is not active", async () => {
    const toAccount = buildAccount({ id: "savings-to", accountNumber: "SV-0002", status: "CLOSED", transactions: [] });
    const { prisma } = buildPrismaMock({ toAccount });

    await expect(
      transferSavingsToSavings(prisma, {
        fromSavingsAccountId: "savings-from",
        toSavingsAccountId: "savings-to",
        actorUserId: "operator-1",
        amountMinor: 500n,
        businessDate: new Date("2026-09-09T00:00:00.000Z"),
        idempotencyKey: "transfer-6",
      }),
    ).rejects.toThrow("Both savings accounts must be active");
  });

  it("rejects transferring to the same account", async () => {
    const { prisma } = buildPrismaMock();

    await expect(
      transferSavingsToSavings(prisma, {
        fromSavingsAccountId: "savings-from",
        toSavingsAccountId: "savings-from",
        actorUserId: "operator-1",
        amountMinor: 500n,
        businessDate: new Date("2026-09-09T00:00:00.000Z"),
        idempotencyKey: "transfer-7",
      }),
    ).rejects.toThrow("Choose two different savings accounts to transfer between");
  });
});

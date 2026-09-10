import type { Prisma, PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

vi.mock("@/modules/lending/application/execute-standing-order-sweep", () => ({
  executeStandingOrderSweepsForSavingsDeposit: vi.fn(async () => 0),
}));

import { executeStandingOrderSweepsForSavingsDeposit } from "@/modules/lending/application/execute-standing-order-sweep";
import {
  postSavingsTransaction,
  recordSavingsTransactionInTransaction,
} from "./post-savings-transaction";

type MockOptions = Readonly<{
  openingBalanceMinor?: bigint;
  productShortName?: string | null;
}>;

function buildTransactionMock(options: MockOptions = {}) {
  const settlementAccount = { id: "settlement-1", name: "Main till", ledgerAccountId: "ledger-cash" };

  const captures: {
    savingsTransactionData: Record<string, unknown> | null;
    journalCreateCalls: unknown[];
    journalLineBatches: unknown[][];
  } = { savingsTransactionData: null, journalCreateCalls: [], journalLineBatches: [] };

  const transaction = {
    savingsAccount: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: "savings-1",
        accountNumber: "SV-0001",
        clientId: "client-1",
        groupId: null,
        productId: "savings-product-1",
        currencyCode: "UGX",
        status: "ACTIVE",
        client: { organizationId: "org-1", officeId: "office-1" },
        group: null,
        product: { shortName: options.productShortName ?? "MSA" },
        transactions: [{ amountMinor: options.openingBalanceMinor ?? 0n }],
      })),
    },
    savingsTransaction: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.savingsTransactionData = data;
        return { id: "savings-tx-1", ...data };
      }),
    },
    settlementAccount: {
      findFirst: vi.fn(async () => settlementAccount),
    },
    savingsProductAccountingMapping: { findUnique: vi.fn(async () => null) },
    savingsAccountingDefaults: { findUnique: vi.fn(async () => null) },
    ledgerAccount: {
      findFirst: vi.fn(async ({ where }: { where: { code: string } }) => {
        if (where.code === "ML-001") return { id: "ledger-savings-liability" };
        if (where.code === "20004") return { id: "ledger-savings-liability-fallback" };
        return null;
      }),
    },
    journal: {
      create: vi.fn(async () => {
        captures.journalCreateCalls.push({});
        return { id: "journal-1" };
      }),
      update: vi.fn(async () => ({ id: "journal-1", status: "POSTED" })),
    },
    journalLine: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        captures.journalLineBatches.push(data);
        return { count: data.length };
      }),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    outboxEvent: { create: vi.fn(async () => ({})) },
    accountingClosure: { findFirst: vi.fn(async () => null) },
  } as unknown as Prisma.TransactionClient;

  return { transaction, captures };
}

function expectBalanced(lines: unknown[]) {
  assertBalancedJournal(
    (lines as Array<{ accountId: string; direction: "DEBIT" | "CREDIT"; amountMinor: bigint }>).map(
      (line) => ({ ...line, currencyCode: "UGX" }),
    ),
  );
}

describe("recordSavingsTransactionInTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts a balanced journal for a deposit: debit settlement, credit savings liability", async () => {
    const { transaction, captures } = buildTransactionMock();

    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: "savings-1",
      actorUserId: "teller-1",
      transactionType: "DEPOSIT",
      amountMinor: 50_000n,
      settlementAccountId: "settlement-1",
      idempotencyKey: "dep-1",
    });

    expect(captures.journalCreateCalls).toHaveLength(1);
    expect(captures.journalLineBatches).toEqual([
      [
        { journalId: "journal-1", accountId: "ledger-cash", direction: "DEBIT", amountMinor: 50_000n, memo: "Main till" },
        { journalId: "journal-1", accountId: "ledger-savings-liability", direction: "CREDIT", amountMinor: 50_000n, memo: "SV-0001" },
      ],
    ]);
    expectBalanced(captures.journalLineBatches[0] as unknown[]);
    expect(captures.savingsTransactionData).toMatchObject({ amountMinor: 50_000n, settlementAccountId: "settlement-1" });
  });

  it("rejects the transaction when the office's accounting period is closed on/before the businessDate", async () => {
    const { transaction } = buildTransactionMock();
    (transaction.accountingClosure.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      closingDate: new Date("2024-06-30T00:00:00.000Z"),
    });

    await expect(
      recordSavingsTransactionInTransaction(transaction, {
        savingsAccountId: "savings-1",
        actorUserId: "teller-1",
        transactionType: "DEPOSIT",
        amountMinor: 50_000n,
        settlementAccountId: "settlement-1",
        idempotencyKey: "dep-closed",
        businessDate: new Date("2024-06-15T00:00:00.000Z"),
      }),
    ).rejects.toThrow(/accounting period/i);
  });


  it("posts a balanced journal for a withdrawal: debit savings liability, credit settlement", async () => {
    const { transaction, captures } = buildTransactionMock({ openingBalanceMinor: 100_000n });

    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: "savings-1",
      actorUserId: "teller-1",
      transactionType: "WITHDRAWAL",
      amountMinor: 30_000n,
      settlementAccountId: "settlement-1",
      idempotencyKey: "wd-1",
    });

    expect(captures.journalCreateCalls).toHaveLength(1);
    expect(captures.journalLineBatches).toEqual([
      [
        { journalId: "journal-1", accountId: "ledger-savings-liability", direction: "DEBIT", amountMinor: 30_000n, memo: "SV-0001" },
        { journalId: "journal-1", accountId: "ledger-cash", direction: "CREDIT", amountMinor: 30_000n, memo: "Main till" },
      ],
    ]);
    expectBalanced(captures.journalLineBatches[0] as unknown[]);
    expect(captures.savingsTransactionData).toMatchObject({ amountMinor: -30_000n, settlementAccountId: "settlement-1" });
  });

  it("does not post a journal when no settlement account is provided (internal mirror calls)", async () => {
    const { transaction, captures } = buildTransactionMock({ openingBalanceMinor: 100_000n });

    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: "savings-1",
      actorUserId: null,
      transactionType: "DEPOSIT",
      amountMinor: 10_000n,
      idempotencyKey: "internal-1",
    });

    expect(captures.journalCreateCalls).toHaveLength(0);
    expect(captures.journalLineBatches).toHaveLength(0);
  });

  it("does not post a journal when postJournal is explicitly false, even with a settlement account", async () => {
    const { transaction, captures } = buildTransactionMock({ openingBalanceMinor: 100_000n });

    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: "savings-1",
      actorUserId: null,
      transactionType: "WITHDRAWAL",
      amountMinor: 10_000n,
      settlementAccountId: "settlement-1",
      idempotencyKey: "sweep-mirror-1",
      postJournal: false,
    });

    expect(captures.journalCreateCalls).toHaveLength(0);
    expect(captures.journalLineBatches).toHaveLength(0);
    expect(captures.savingsTransactionData).toMatchObject({ amountMinor: -10_000n, settlementAccountId: "settlement-1" });
  });

  it("falls back to the org-wide SavingsAccountingDefaults liability account when configured", async () => {
    const { transaction, captures } = buildTransactionMock({ productShortName: "UNKNOWN_PRODUCT" });
    (transaction.savingsAccountingDefaults.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      savingsLiabilityAccountId: "ledger-org-default-liability",
    });

    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: "savings-1",
      actorUserId: "teller-1",
      transactionType: "DEPOSIT",
      amountMinor: 20_000n,
      settlementAccountId: "settlement-1",
      idempotencyKey: "dep-org-default",
    });

    expect(captures.journalLineBatches[0]).toEqual([
      { journalId: "journal-1", accountId: "ledger-cash", direction: "DEBIT", amountMinor: 20_000n, memo: "Main till" },
      { journalId: "journal-1", accountId: "ledger-org-default-liability", direction: "CREDIT", amountMinor: 20_000n, memo: "SV-0001" },
    ]);
  });

  it("prefers the per-product SavingsProductAccountingMapping over the org-wide default", async () => {
    const { transaction, captures } = buildTransactionMock();
    (transaction.savingsProductAccountingMapping.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      savingsLiabilityAccountId: "ledger-product-specific-liability",
    });
    (transaction.savingsAccountingDefaults.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      savingsLiabilityAccountId: "ledger-org-default-liability",
    });

    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: "savings-1",
      actorUserId: "teller-1",
      transactionType: "DEPOSIT",
      amountMinor: 15_000n,
      settlementAccountId: "settlement-1",
      idempotencyKey: "dep-product-mapping",
    });

    expect(captures.journalLineBatches[0]).toEqual([
      { journalId: "journal-1", accountId: "ledger-cash", direction: "DEBIT", amountMinor: 15_000n, memo: "Main till" },
      { journalId: "journal-1", accountId: "ledger-product-specific-liability", direction: "CREDIT", amountMinor: 15_000n, memo: "SV-0001" },
    ]);
  });
});

describe("postSavingsTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("immediately checks due loans after a real client deposit posts", async () => {
    const { transaction } = buildTransactionMock();
    const prisma = {
      savingsTransaction: {
        findUnique: vi.fn(async () => null),
      },
      savingsAccount: {
        findUnique: vi.fn(async () => ({ id: "savings-1", status: "ACTIVE" })),
      },
      $transaction: vi.fn(async (callback: (tx: Prisma.TransactionClient) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient;

    const businessDate = new Date("2026-09-09T08:00:00.000Z");
    await postSavingsTransaction(prisma, {
      savingsAccountId: "savings-1",
      actorUserId: "teller-1",
      transactionType: "DEPOSIT",
      amountMinor: 40_000n,
      settlementAccountId: "settlement-1",
      idempotencyKey: "deposit-1",
      businessDate,
    });

    expect(executeStandingOrderSweepsForSavingsDeposit).toHaveBeenCalledWith(prisma, {
      savingsAccountId: "savings-1",
      savingsTransactionId: "savings-tx-1",
      now: businessDate,
    });
  });

  it("does not re-trigger standing-order sweeps for internal mirror deposits", async () => {
    const prisma = {
      savingsTransaction: {
        findUnique: vi.fn(async () => ({ id: "savings-tx-existing", savingsAccountId: "savings-1" })),
      },
    } as unknown as PrismaClient;

    await postSavingsTransaction(prisma, {
      savingsAccountId: "savings-1",
      actorUserId: null,
      transactionType: "DEPOSIT",
      amountMinor: 40_000n,
      settlementAccountId: "settlement-1",
      idempotencyKey: "deposit-2",
      postJournal: false,
    });

    expect(executeStandingOrderSweepsForSavingsDeposit).not.toHaveBeenCalled();
  });
});

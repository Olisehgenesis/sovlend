import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

vi.mock("../domain/repayment-schedule", () => ({
  generateRepaymentSchedule: vi.fn(() => [
    {
      installmentNumber: 1,
      dueOn: new Date("2026-10-15T00:00:00.000Z"),
      principalDueMinor: 120_000n,
      interestDueMinor: 30_000n,
      feesDueMinor: 0n,
      penaltiesDueMinor: 0n,
    },
  ]),
}));

import { disburseLoan } from "./disburse-loan";

type MockOptions = Readonly<{
  feeIncomeAccountId?: string | null;
  principalMinor?: bigint;
  charges?: Array<{ id: string; amountMinor: bigint }>;
  destination?: "SETTLEMENT_ACCOUNT" | "SAVINGS_ACCOUNT";
  savingsAccounts?: Array<{
    id: string;
    accountNumber: string;
    isDefault: boolean;
    productShortName?: string | null;
    openingBalanceMinor?: bigint;
  }>;
}>;

function buildPrismaMock(options: MockOptions = {}) {
  const settlementAccount = {
    id: "settlement-1",
    name: "Main till",
    ledgerAccountId: "ledger-cash",
  };
  const charges = options.charges ?? [];
  const savingsAccounts = options.savingsAccounts ?? [
    {
      id: "savings-1",
      accountNumber: "SV-0001",
      isDefault: true,
      productShortName: "MSA",
      openingBalanceMinor: 0n,
    },
  ];

  const captures: Record<string, unknown> = {
    loanTransactionData: null,
    journalLines: [],
    savingsTransactionData: null,
    chargeUpdateArgs: null,
  };

  const loan = {
    id: "loan-1",
    clientId: "client-1",
    officeId: "office-1",
    accountNumber: "LN-0001",
    status: "APPROVED",
    disbursedOn: null,
    principalMinor: options.principalMinor ?? 1_000_000n,
    denominationCurrency: "UGX",
    termsSnapshot: {
      annualRateBps: 1_200,
      monitoringFeeAnnualRateBps: 0,
      repaymentCount: 1,
      repaymentFrequency: "MONTHLY",
      interestMethod: "FLAT",
    },
    application: {
      submittedById: "maker-1",
      approvals: [{ reviewerId: "checker-1" }],
    },
    product: {
      accountingMapping: {
        principalReceivableAccountId: "ledger-principal",
        feeIncomeAccountId:
          options.feeIncomeAccountId === undefined
            ? "ledger-fee-income"
            : options.feeIncomeAccountId,
      },
    },
    office: {
      organizationId: "org-1",
    },
  };

  const transaction = {
    loan: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    charge: {
      findMany: vi.fn(async () =>
        charges.map((charge) => ({ ...charge, name: `Charge ${charge.id}` })),
      ),
      updateMany: vi.fn(async (args) => {
        captures.chargeUpdateArgs = args;
        return { count: charges.length };
      }),
    },
    savingsAccount: {
      findMany: vi.fn(async () =>
        savingsAccounts.map((account) => ({
          id: account.id,
          accountNumber: account.accountNumber,
          isDefault: account.isDefault,
          product: { shortName: account.productShortName ?? null },
        })),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const account = savingsAccounts.find((item) => item.id === where.id);
        if (!account) throw new Error("Savings account not found");
        return {
          id: account.id,
          accountNumber: account.accountNumber,
          clientId: "client-1",
          groupId: null,
          currencyCode: "UGX",
          status: "ACTIVE",
          client: { organizationId: "org-1" },
          group: null,
          transactions: [{ amountMinor: account.openingBalanceMinor ?? 0n }],
        };
      }),
    },
    ledgerAccount: {
      findFirst: vi.fn(async ({ where }: { where: { code: string } }) => {
        if (where.code === "ML-001") return { id: "ledger-savings-liability" };
        if (where.code === "20004") return { id: "ledger-savings-liability-fallback" };
        return null;
      }),
    },
    loanInstallment: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
    loanTransaction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.loanTransactionData = data;
        return { id: "loan-tx-1", ...data };
      }),
      findUnique: vi.fn(async () => null),
    },
    savingsTransaction: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.savingsTransactionData = data;
        return { id: "savings-tx-1", ...data };
      }),
    },
    journal: {
      create: vi.fn(async () => ({ id: "journal-1" })),
      update: vi.fn(async () => ({ id: "journal-1", status: "POSTED" })),
    },
    journalLine: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        captures.journalLines = data;
        return { count: data.length };
      }),
    },
    auditEvent: {
      create: vi.fn(async () => ({})),
    },
    outboxEvent: {
      create: vi.fn(async () => ({})),
    },
    settlementAccount: {
      findFirst: vi.fn(async () => settlementAccount),
    },
  };

  const prisma = {
    loanTransaction: { findUnique: vi.fn(async () => null) },
    loan: { findUnique: vi.fn(async () => loan) },
    user: { findUnique: vi.fn(async () => ({ systemRole: "LOAN_OFFICER" })) },
    settlementAccount: {
      findFirst: vi.fn(async () =>
        options.destination === "SAVINGS_ACCOUNT" ? null : settlementAccount,
      ),
    },
    savingsAccount: {
      findMany: transaction.savingsAccount.findMany,
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;

  return { prisma, captures };
}

function expectBalanced(lines: unknown[]) {
  assertBalancedJournal(
    (lines as Array<{
      accountId: string;
      direction: "DEBIT" | "CREDIT";
      amountMinor: bigint;
    }>).map((line) => ({
      accountId: line.accountId,
      direction: line.direction,
      amountMinor: line.amountMinor,
      currencyCode: "UGX",
    })),
  );
}

describe("disburseLoan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the zero-fee settlement disbursement journal identical to the legacy 2-line shape", async () => {
    const { prisma, captures } = buildPrismaMock({ charges: [] });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      destination: { type: "SETTLEMENT_ACCOUNT", settlementAccountId: "settlement-1" },
      businessDate: new Date("2026-09-08T00:00:00.000Z"),
      externalReference: "RCPT-1",
      idempotencyKey: "82e8d8fb-0e46-4164-a2ff-6a6d01ab17f0",
    });

    expect(captures.loanTransactionData).toMatchObject({
      settlementChannel: "Main till",
      settlementAccountId: "settlement-1",
      settlementAmountMinor: 1_000_000n,
      denominationAmountMinor: 1_000_000n,
    });
    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-principal",
        direction: "DEBIT",
        amountMinor: 1_000_000n,
        memo: "LN-0001",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "CREDIT",
        amountMinor: 1_000_000n,
        memo: "Main till",
      },
    ]);
    expect(captures.savingsTransactionData).toBeNull();
    expect(captures.chargeUpdateArgs).toBeNull();
    expectBalanced(captures.journalLines as unknown[]);
  });

  it("nets pending due-at-disbursement charges against a settlement payout and keeps the journal balanced", async () => {
    const { prisma, captures } = buildPrismaMock({
      charges: [
        { id: "charge-1", amountMinor: 125_000n },
        { id: "charge-2", amountMinor: 25_000n },
      ],
    });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      destination: { type: "SETTLEMENT_ACCOUNT", settlementAccountId: "settlement-1" },
      businessDate: new Date("2026-09-08T00:00:00.000Z"),
      idempotencyKey: "5d41de41-0830-4acd-947e-f2de79f45c59",
    });

    expect(captures.loanTransactionData).toMatchObject({
      settlementAmountMinor: 850_000n,
      denominationAmountMinor: 1_000_000n,
    });
    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-principal",
        direction: "DEBIT",
        amountMinor: 1_000_000n,
        memo: "LN-0001",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-fee-income",
        direction: "CREDIT",
        amountMinor: 150_000n,
        memo: "Disbursement fees",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "CREDIT",
        amountMinor: 850_000n,
        memo: "Main till",
      },
    ]);
    expect(captures.chargeUpdateArgs).toMatchObject({
      where: { id: { in: ["charge-1", "charge-2"] } },
      data: { status: "PAID" },
    });
    expectBalanced(captures.journalLines as unknown[]);
  });

  it("credits the client's savings account with net proceeds and keeps the loan journal balanced", async () => {
    const { prisma, captures } = buildPrismaMock({
      charges: [{ id: "charge-1", amountMinor: 200_000n }],
      destination: "SAVINGS_ACCOUNT",
    });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      destination: { type: "SAVINGS_ACCOUNT", savingsAccountId: "savings-1" },
      businessDate: new Date("2026-09-08T00:00:00.000Z"),
      idempotencyKey: "55c1b66c-1f48-472d-a17d-c0838f7cbadf",
    });

    expect(captures.loanTransactionData).toMatchObject({
      settlementChannel: "Savings SV-0001",
      settlementAccountId: undefined,
      settlementAmountMinor: 800_000n,
      denominationAmountMinor: 1_000_000n,
    });
    expect(captures.savingsTransactionData).toMatchObject({
      savingsAccountId: "savings-1",
      transactionType: "DEPOSIT",
      amountMinor: 800_000n,
      reason: "Loan disbursement",
      idempotencyKey: "loan-disbursement:loan-tx-1:savings-credit",
    });
    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-principal",
        direction: "DEBIT",
        amountMinor: 1_000_000n,
        memo: "LN-0001",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-fee-income",
        direction: "CREDIT",
        amountMinor: 200_000n,
        memo: "Disbursement fees",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-savings-liability",
        direction: "CREDIT",
        amountMinor: 800_000n,
        memo: "SV-0001",
      },
    ]);
    expectBalanced(captures.journalLines as unknown[]);
  });

  it("rejects disbursement when fees exceed principal", async () => {
    const { prisma } = buildPrismaMock({
      principalMinor: 100_000n,
      charges: [{ id: "charge-1", amountMinor: 120_000n }],
    });

    await expect(
      disburseLoan(prisma, {
        loanId: "loan-1",
        actorUserId: "operator-1",
        destination: { type: "SETTLEMENT_ACCOUNT", settlementAccountId: "settlement-1" },
        businessDate: new Date("2026-09-08T00:00:00.000Z"),
        idempotencyKey: "7256e9dd-84d4-4749-91f3-a26fa9260915",
      }),
    ).rejects.toThrow("Disbursement fees exceed the approved principal");
  });

  it("rejects disbursement when fee income mapping is missing for pending fees", async () => {
    const { prisma } = buildPrismaMock({
      feeIncomeAccountId: null,
      charges: [{ id: "charge-1", amountMinor: 50_000n }],
    });

    await expect(
      disburseLoan(prisma, {
        loanId: "loan-1",
        actorUserId: "operator-1",
        destination: { type: "SETTLEMENT_ACCOUNT", settlementAccountId: "settlement-1" },
        businessDate: new Date("2026-09-08T00:00:00.000Z"),
        idempotencyKey: "8e04245f-a4ca-44ef-a36f-2ff4d93da0dc",
      }),
    ).rejects.toThrow("Fee income account is not configured for this loan product");
  });
});

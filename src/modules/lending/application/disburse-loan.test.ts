import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

const authorizationState = vi.hoisted(() => ({
  allowBtcOverCap: false,
  seenContexts: [] as unknown[],
}));

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}

    async isAllowed(context: unknown) {
      authorizationState.seenContexts.push(context);
      if (
        context &&
        typeof context === "object" &&
        "permission" in context &&
        context.permission === "LOAN_DISBURSE_BTC_OVER_CAP"
      ) {
        return authorizationState.allowBtcOverCap;
      }
      return true;
    }
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
  admissionFeeIncomeAccountId?: string | null;
  processingFeeIncomeAccountId?: string | null;
  principalMinor?: bigint;
  charges?: Array<{ id: string; amountMinor: bigint; name?: string }>;
  groupLoan?: boolean;
  existingAuditEvents?: Array<{
    action: string;
    actorId: string | null;
    entityType?: string;
    occurredAt?: Date;
    metadata: Record<string, unknown>;
  }>;
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
    auditEvents: [] as Array<Record<string, unknown>>,
  };
  const auditEvents = [...(options.existingAuditEvents ?? [])];
  const priceSnapshots = {
    btcUsd: { id: "price-btc-usd-1", price: "60000" },
    usdUgx: { id: "price-usd-ugx-1", price: "4000" },
  };

  const loan = {
    id: "loan-1",
    clientId: options.groupLoan ? null : "client-1",
    groupId: options.groupLoan ? "group-1" : null,
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
        admissionFeeIncomeAccountId: options.admissionFeeIncomeAccountId ?? null,
        processingFeeIncomeAccountId: options.processingFeeIncomeAccountId ?? null,
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
        charges.map((charge) => ({ ...charge, name: charge.name ?? `Charge ${charge.id}` })),
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
          product: { id: `${account.id}-product`, shortName: account.productShortName ?? null },
        })),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const account = savingsAccounts.find((item) => item.id === where.id);
        if (!account) throw new Error("Savings account not found");
        return {
          id: account.id,
          accountNumber: account.accountNumber,
          clientId: options.groupLoan ? null : "client-1",
          groupId: options.groupLoan ? "group-1" : null,
          currencyCode: "UGX",
          status: "ACTIVE",
          client: options.groupLoan ? null : { organizationId: "org-1" },
          group: options.groupLoan ? { organizationId: "org-1" } : null,
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
    savingsProductAccountingMapping: {
      findUnique: vi.fn(async () => null),
    },
    savingsAccountingDefaults: {
      findUnique: vi.fn(async () => null),
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
      findMany: vi.fn(async () => auditEvents),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push({
          action: String(data.action),
          actorId: (data.actorId as string | null | undefined) ?? null,
          entityType: String(data.entityType),
          occurredAt: new Date(),
          metadata: (data.metadata as Record<string, unknown>) ?? {},
        });
        (captures.auditEvents as Array<Record<string, unknown>>).push(data);
        return {};
      }),
    },
    outboxEvent: {
      create: vi.fn(async () => ({})),
    },
    settlementAccount: {
      findFirst: vi.fn(async () => settlementAccount),
    },
    priceSnapshot: {
      findFirst: vi.fn(async ({ where }: { where: { baseCode: string; quoteCode: string } }) => {
        if (where.baseCode === "BTC" && where.quoteCode === "USD") return priceSnapshots.btcUsd;
        if (where.baseCode === "USD" && where.quoteCode === "UGX") return priceSnapshots.usdUgx;
        return null;
      }),
    },
  };

  const prisma = {
    loanTransaction: { findUnique: vi.fn(async () => null) },
    loan: { findUnique: vi.fn(async () => loan) },
    user: { findUnique: vi.fn(async () => ({ systemRole: "LOAN_OFFICER" })) },
    settlementAccount: {
      findFirst: vi.fn(async () => settlementAccount),
    },
    savingsAccount: {
      findMany: transaction.savingsAccount.findMany,
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push({
          action: String(data.action),
          actorId: (data.actorId as string | null | undefined) ?? null,
          entityType: String(data.entityType),
          occurredAt: new Date(),
          metadata: (data.metadata as Record<string, unknown>) ?? {},
        });
        (captures.auditEvents as Array<Record<string, unknown>>).push(data);
        return {};
      }),
    },
    accountingClosure: { findFirst: vi.fn(async () => null) },
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
    authorizationState.allowBtcOverCap = false;
    authorizationState.seenContexts = [];
  });

  it("credits the client's savings account with net proceeds and keeps the loan journal balanced", async () => {
    const { prisma, captures } = buildPrismaMock({ charges: [] });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      businessDate: new Date("2026-09-08T00:00:00.000Z"),
      externalReference: "RCPT-1",
      idempotencyKey: "82e8d8fb-0e46-4164-a2ff-6a6d01ab17f0",
    });

    expect(captures.loanTransactionData).toMatchObject({
      settlementChannel: "Savings SV-0001",
      settlementAccountId: undefined,
      settlementAmountMinor: 1_000_000n,
      denominationAmountMinor: 1_000_000n,
    });
    expect(captures.savingsTransactionData).toMatchObject({
      savingsAccountId: "savings-1",
      transactionType: "DEPOSIT",
      amountMinor: 1_000_000n,
      reason: "Loan disbursement",
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
        accountId: "ledger-savings-liability",
        direction: "CREDIT",
        amountMinor: 1_000_000n,
        memo: "SV-0001",
      },
    ]);
    expect(captures.chargeUpdateArgs).toBeNull();
    expectBalanced(captures.journalLines as unknown[]);
  });

  it("nets pending due-at-disbursement charges against the savings credit and keeps the journal balanced", async () => {
    const { prisma, captures } = buildPrismaMock({
      charges: [
        { id: "charge-1", amountMinor: 125_000n },
        { id: "charge-2", amountMinor: 25_000n },
      ],
    });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
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
        accountId: "ledger-savings-liability",
        direction: "CREDIT",
        amountMinor: 850_000n,
        memo: "SV-0001",
      },
    ]);
    expect(captures.chargeUpdateArgs).toMatchObject({
      where: { id: { in: ["charge-1", "charge-2"] } },
      data: { status: "PAID" },
    });
    expectBalanced(captures.journalLines as unknown[]);
  });

  it("records the payment method as informational metadata only, never as the journal credit target", async () => {
    const { prisma, captures } = buildPrismaMock({ charges: [] });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      paymentMethodSettlementAccountId: "settlement-1",
      businessDate: new Date("2026-09-08T00:00:00.000Z"),
      idempotencyKey: "9b9d0f0a-7b46-4a1d-9f5a-1a9a2c9d7e01",
    });

    expect(captures.loanTransactionData).toMatchObject({
      settlementChannel: "Main till",
      settlementAccountId: "settlement-1",
      settlementAmountMinor: 1_000_000n,
    });
    // Even with a payment method recorded, the journal still credits the savings
    // liability account — never the settlement account's own ledger account.
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
        accountId: "ledger-savings-liability",
        direction: "CREDIT",
        amountMinor: 1_000_000n,
        memo: "SV-0001",
      },
    ]);
    expectBalanced(captures.journalLines as unknown[]);
  });

  it("credits the group's savings account for group loans", async () => {
    const { prisma, captures } = buildPrismaMock({ groupLoan: true, charges: [] });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      businessDate: new Date("2026-09-08T00:00:00.000Z"),
      idempotencyKey: "0f3f9f2f-3f0f-4a2f-9f0f-1f2f3f4f5f6f",
    });

    expect(captures.savingsTransactionData).toMatchObject({
      savingsAccountId: "savings-1",
      transactionType: "DEPOSIT",
      amountMinor: 1_000_000n,
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
        accountId: "ledger-savings-liability",
        direction: "CREDIT",
        amountMinor: 1_000_000n,
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
        businessDate: new Date("2026-09-08T00:00:00.000Z"),
        idempotencyKey: "8e04245f-a4ca-44ef-a36f-2ff4d93da0dc",
      }),
    ).rejects.toThrow("Fee income account is not configured for this loan product");
  });

  it("rejects disbursement when there is no active savings account to credit", async () => {
    const { prisma } = buildPrismaMock({ savingsAccounts: [] });

    await expect(
      disburseLoan(prisma, {
        loanId: "loan-1",
        actorUserId: "operator-1",
        businessDate: new Date("2026-09-08T00:00:00.000Z"),
        idempotencyKey: "1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d",
      }),
    ).rejects.toThrow("Client has no active savings account available for loan disbursement");
  });

  it("splits admission and processing fees into their own income accounts, keeping the journal balanced", async () => {
    const { prisma, captures } = buildPrismaMock({
      admissionFeeIncomeAccountId: "ledger-admission-income",
      processingFeeIncomeAccountId: "ledger-processing-income",
      charges: [
        { id: "charge-1", amountMinor: 40_000n, name: "Admission fee" },
        { id: "charge-2", amountMinor: 25_000n, name: "Loan processing fee" },
        { id: "charge-3", amountMinor: 10_000n, name: "Legal fee" },
      ],
    });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      businessDate: new Date("2026-09-08T00:00:00.000Z"),
      idempotencyKey: "b2b7e5f0-6b8e-4f8f-9f1a-6a2c3f7a9d11",
    });

    expect(captures.journalLines).toEqual([
      { journalId: "journal-1", accountId: "ledger-principal", direction: "DEBIT", amountMinor: 1_000_000n, memo: "LN-0001" },
      { journalId: "journal-1", accountId: "ledger-admission-income", direction: "CREDIT", amountMinor: 40_000n, memo: "Admission fee" },
      { journalId: "journal-1", accountId: "ledger-processing-income", direction: "CREDIT", amountMinor: 25_000n, memo: "Processing fee" },
      { journalId: "journal-1", accountId: "ledger-fee-income", direction: "CREDIT", amountMinor: 10_000n, memo: "Disbursement fees" },
      { journalId: "journal-1", accountId: "ledger-savings-liability", direction: "CREDIT", amountMinor: 925_000n, memo: "SV-0001" },
    ]);
    expectBalanced(captures.journalLines as unknown[]);
  });

  it("falls back admission/processing fees to the legacy shared fee income account when dedicated mappings are absent", async () => {
    const { prisma, captures } = buildPrismaMock({
      charges: [
        { id: "charge-1", amountMinor: 40_000n, name: "Admission fee" },
        { id: "charge-2", amountMinor: 25_000n, name: "Loan processing fee" },
      ],
    });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      businessDate: new Date("2026-09-08T00:00:00.000Z"),
      idempotencyKey: "3ad0d3f9-5c8e-4c1a-9e33-1f9d6b2a7e44",
    });

    // Both charges fall back to the same legacy feeIncomeAccountId and merge into a single line,
    // identical to today's behavior when the new mapping fields are not configured.
    expect(captures.journalLines).toEqual([
      { journalId: "journal-1", accountId: "ledger-principal", direction: "DEBIT", amountMinor: 1_000_000n, memo: "LN-0001" },
      { journalId: "journal-1", accountId: "ledger-fee-income", direction: "CREDIT", amountMinor: 65_000n, memo: "Disbursement fees" },
      { journalId: "journal-1", accountId: "ledger-savings-liability", direction: "CREDIT", amountMinor: 935_000n, memo: "SV-0001" },
    ]);
    expectBalanced(captures.journalLines as unknown[]);
  });

  it("rejects disbursement when the office's accounting period is closed on/before the businessDate", async () => {
    const { prisma } = buildPrismaMock({});
    (prisma.accountingClosure.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ closingDate: new Date("2026-09-08T00:00:00.000Z") });

    await expect(
      disburseLoan(prisma, {
        loanId: "loan-1",
        actorUserId: "operator-1",
        businessDate: new Date("2026-09-08T00:00:00.000Z"),
        idempotencyKey: "1c9c2a3e-8f9a-4b6d-9c1a-2f3e4d5c6b7a",
      }),
    ).rejects.toThrow("closed on or before");
  });

  it("allows a cashier's first same-day BTC disbursement under the $500 cap", async () => {
    const { prisma, captures } = buildPrismaMock({ principalMinor: 80_000_000n });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "cashier-1",
      businessDate: new Date("2026-09-14T00:00:00.000Z"),
      idempotencyKey: "7b6a7d29-2152-4b1f-b0c2-f542ee8b25de",
      payeeType: "BLINK",
      payeeReference: "alice@blink",
    });

    expect(captures.loanTransactionData).toMatchObject({
      settlementAmountMinor: 80_000_000n,
      priceSnapshotId: "price-btc-usd-1",
    });
    expect(captures.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "loan.disbursed",
          metadata: expect.objectContaining({
            businessDate: "2026-09-14",
            payeeType: "BLINK",
            btcUsdEquivalentMinor: "20000",
            btcDailyCapUsdMinor: "50000",
            btcUsdSnapshotId: "price-btc-usd-1",
            usdUgxPrice: "4000",
          }),
        }),
      ]),
    );
  });

  it("rejects a BTC disbursement that would push the same cashier over the daily cap and records a blocked audit event", async () => {
    const { prisma, captures } = buildPrismaMock({
      principalMinor: 80_000_000n,
      existingAuditEvents: [
        {
          action: "loan.disbursed",
          actorId: "cashier-1",
          entityType: "Loan",
          metadata: {
            businessDate: "2026-09-14",
            payeeType: "BLINK",
            btcUsdEquivalentMinor: "35000",
          },
        },
      ],
    });

    await expect(
      disburseLoan(prisma, {
        loanId: "loan-1",
        actorUserId: "cashier-1",
        businessDate: new Date("2026-09-14T00:00:00.000Z"),
        idempotencyKey: "27d48818-f825-4b26-a816-a2b1f8c6e150",
        payeeType: "BLINK",
        payeeReference: "alice@blink",
      }),
    ).rejects.toThrow("BTC disbursements above $500/day require branch-manager approval");

    expect(captures.loanTransactionData).toBeNull();
    expect(captures.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "loan.disbursement.btc_cap_blocked",
          metadata: expect.objectContaining({
            businessDate: "2026-09-14",
            currentDisbursementUsdMinor: "20000",
            priorDisbursementUsdMinor: "35000",
            attemptedDisbursementUsdMinor: "55000",
            requiredPermission: "LOAN_DISBURSE_BTC_OVER_CAP",
          }),
        }),
      ]),
    );
  });

  it("lets a manager-authorized actor execute an over-cap BTC disbursement", async () => {
    authorizationState.allowBtcOverCap = true;
    const { prisma, captures } = buildPrismaMock({
      principalMinor: 120_000_000n,
      existingAuditEvents: [
        {
          action: "loan.disbursed",
          actorId: "manager-1",
          entityType: "Loan",
          metadata: {
            businessDate: "2026-09-14",
            payeeType: "BLINK",
            btcUsdEquivalentMinor: "30000",
          },
        },
      ],
    });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "manager-1",
      businessDate: new Date("2026-09-14T00:00:00.000Z"),
      idempotencyKey: "d4ac7356-6629-490a-83bd-f6ef4d48eeca",
      payeeType: "BLINK",
      payeeReference: "manager@blink",
    });

    expect(captures.loanTransactionData).toMatchObject({
      settlementAmountMinor: 120_000_000n,
      priceSnapshotId: "price-btc-usd-1",
    });
    expect(captures.auditEvents).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "loan.disbursement.btc_cap_blocked" })]),
    );
    expect(captures.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "loan.disbursed",
          metadata: expect.objectContaining({
            payeeType: "BLINK",
            btcUsdEquivalentMinor: "30000",
            btcCapOverrideUsed: true,
          }),
        }),
      ]),
    );
  });

  it("resets the BTC cap on the next business day", async () => {
    const { prisma, captures } = buildPrismaMock({
      principalMinor: 120_000_000n,
      existingAuditEvents: [
        {
          action: "loan.disbursed",
          actorId: "cashier-1",
          entityType: "Loan",
          metadata: {
            businessDate: "2026-09-13",
            payeeType: "BLINK",
            btcUsdEquivalentMinor: "45000",
          },
        },
      ],
    });

    await disburseLoan(prisma, {
      loanId: "loan-1",
      actorUserId: "cashier-1",
      businessDate: new Date("2026-09-14T00:00:00.000Z"),
      idempotencyKey: "dbf28c83-b4fd-4143-8ebe-0a18e4c352c3",
      payeeType: "BLINK",
      payeeReference: "alice@blink",
    });

    expect(captures.loanTransactionData).toMatchObject({
      settlementAmountMinor: 120_000_000n,
      priceSnapshotId: "price-btc-usd-1",
    });
  });

  it("accumulates multiple same-day BTC disbursements for the same cashier toward the cap", async () => {
    const { prisma } = buildPrismaMock({
      principalMinor: 60_000_000n,
      existingAuditEvents: [
        {
          action: "loan.disbursed",
          actorId: "cashier-1",
          entityType: "Loan",
          metadata: {
            businessDate: "2026-09-14",
            payeeType: "BLINK",
            btcUsdEquivalentMinor: "15000",
          },
        },
        {
          action: "loan.disbursed",
          actorId: "cashier-1",
          entityType: "Loan",
          metadata: {
            businessDate: "2026-09-14",
            payeeType: "BLINK",
            btcUsdEquivalentMinor: "25000",
          },
        },
      ],
    });

    await expect(
      disburseLoan(prisma, {
        loanId: "loan-1",
        actorUserId: "cashier-1",
        businessDate: new Date("2026-09-14T00:00:00.000Z"),
        idempotencyKey: "f81a4d0e-7093-48a7-acbf-b6d0cba34083",
        payeeType: "BLINK",
        payeeReference: "alice@blink",
      }),
    ).rejects.toThrow("BTC disbursements above $500/day require branch-manager approval");
  });
});

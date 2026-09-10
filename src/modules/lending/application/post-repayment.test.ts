import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { postRepayment } from "./post-repayment";

type MockOptions = Readonly<{
  penaltyAssessedOn?: Date | null;
  interestAccruedOn?: Date | null;
  installment?: Partial<{
    principalDueMinor: bigint;
    interestDueMinor: bigint;
    feesDueMinor: bigint;
    penaltiesDueMinor: bigint;
    monitoringFeeDueMinor: bigint;
    principalPaidMinor: bigint;
    interestPaidMinor: bigint;
    feesPaidMinor: bigint;
    penaltiesPaidMinor: bigint;
    monitoringFeePaidMinor: bigint;
  }>;
  activeSavingsAccounts?: Array<{
    id: string;
    accountNumber: string;
    isDefault?: boolean;
    balanceMinor?: bigint;
    productId?: string | null;
    productShortName?: string | null;
  }>;
}>;

function buildPrismaMock(options: MockOptions = {}) {
  const loan = {
    id: "loan-1",
    officeId: "office-1",
    clientId: "client-1",
    groupId: null,
    accountNumber: "LN-0001",
    status: "ACTIVE",
    denominationCurrency: "UGX",
    office: { organizationId: "org-1" },
  };

  const installment = {
    id: "installment-1",
    dueOn: new Date("2026-09-01T00:00:00.000Z"),
    installmentNumber: 1,
    principalDueMinor: options.installment?.principalDueMinor ?? 0n,
    interestDueMinor: options.installment?.interestDueMinor ?? 0n,
    feesDueMinor: options.installment?.feesDueMinor ?? 0n,
    penaltiesDueMinor: options.installment?.penaltiesDueMinor ?? 300n,
    monitoringFeeDueMinor: options.installment?.monitoringFeeDueMinor ?? 0n,
    principalPaidMinor: options.installment?.principalPaidMinor ?? 0n,
    interestPaidMinor: options.installment?.interestPaidMinor ?? 0n,
    feesPaidMinor: options.installment?.feesPaidMinor ?? 0n,
    penaltiesPaidMinor: options.installment?.penaltiesPaidMinor ?? 0n,
    monitoringFeePaidMinor: options.installment?.monitoringFeePaidMinor ?? 0n,
    principalWaivedMinor: 0n,
    interestWaivedMinor: 0n,
    feesWaivedMinor: 0n,
    penaltiesWaivedMinor: 0n,
    monitoringFeeWaivedMinor: 0n,
    penaltyAssessedOn: options.penaltyAssessedOn ?? null,
    interestAccruedOn: options.interestAccruedOn ?? null,
  };

  const savingsAccounts = (options.activeSavingsAccounts ?? []).map((account, index) => ({
    id: account.id,
    accountNumber: account.accountNumber,
    clientId: loan.clientId,
    groupId: null,
    productId: account.productId ?? "savings-product-1",
    status: "ACTIVE",
    currencyCode: "UGX",
    isDefault: account.isDefault ?? false,
    createdAt: new Date(`2026-09-0${index + 1}T00:00:00.000Z`),
    client: { organizationId: "org-1", officeId: "office-1" },
    group: null,
    product: { shortName: account.productShortName ?? "MSA" },
    transactions: [{ amountMinor: account.balanceMinor ?? 0n }],
  }));
  const savingsAccountsById = new Map(
    savingsAccounts.map((account) => [account.id, account]),
  );

  const captures: {
    journalLines: unknown[];
    savingsTransactions: unknown[];
    loanUpdates: Array<{ status: string }>;
  } = { journalLines: [], savingsTransactions: [], loanUpdates: [] };

  const transaction = {
    loan: {
      findUniqueOrThrow: vi.fn(async () => ({
        ...loan,
        installments: [installment],
        product: {
          accountingMapping: {
            principalReceivableAccountId: "ledger-principal",
            interestIncomeAccountId: "ledger-interest-income",
            interestReceivableAccountId: "ledger-interest-receivable",
            feeIncomeAccountId: "ledger-fee-income",
            monitoringFeeIncomeAccountId: "ledger-monitoring-income",
            penaltyIncomeAccountId: "ledger-penalty-income",
            penaltyReceivableAccountId: "ledger-penalty-receivable",
            overpaymentLiabilityAccountId: "ledger-overpayment",
          },
        },
        office: { organizationId: "org-1" },
      })),
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        captures.loanUpdates.push(data);
        return { ...loan, ...data };
      }),
    },
    loanTransaction: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "loan-tx-1",
        ...data,
      })),
    },
    loanInstallment: {
      update: vi.fn(async () => ({})),
    },
    loanTransactionAllocation: {
      create: vi.fn(async () => ({})),
    },
    settlementAccount: {
      findFirst: vi.fn(async () => ({
        id: "settlement-1",
        name: "Main till",
        ledgerAccountId: "ledger-cash",
      })),
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
    savingsAccount: {
      findMany: vi.fn(async () =>
        savingsAccounts.map((account) => ({
          id: account.id,
          accountNumber: account.accountNumber,
          productId: account.productId,
          isDefault: account.isDefault,
          product: account.product,
        })),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const account = savingsAccountsById.get(where.id);
        if (!account) throw new Error("Savings account not found");
        return account;
      }),
    },
    savingsTransaction: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.savingsTransactions.push(data);
        return { id: `savings-tx-${captures.savingsTransactions.length}`, ...data };
      }),
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
    auditEvent: { create: vi.fn(async () => ({})) },
    outboxEvent: { create: vi.fn(async () => ({})) },
    accountingClosure: { findFirst: vi.fn(async () => null) },
  };

  const prisma = {
    loanTransaction: { findUnique: vi.fn(async () => null) },
    loan: { findUnique: vi.fn(async () => loan) },
    settlementAccount: {
      findFirst: vi.fn(async () => ({
        id: "settlement-1",
        name: "Main till",
        ledgerAccountId: "ledger-cash",
      })),
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;

  return { prisma, captures, transaction };
}

function expectBalanced(lines: unknown[]) {
  expect(() =>
    assertBalancedJournal(
      (lines as Array<{
        accountId: string;
        direction: "DEBIT" | "CREDIT";
        amountMinor: bigint;
      }>).map((line) => ({ ...line, currencyCode: "UGX" })),
    ),
  ).not.toThrow();
}

describe("postRepayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("credits assessed penalties to the receivable account instead of penalty income", async () => {
    const { prisma, captures } = buildPrismaMock({
      penaltyAssessedOn: new Date("2026-09-04T00:00:00.000Z"),
    });

    await postRepayment(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      amountMinor: 300n,
      settlementAccountId: "settlement-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "repayment-1",
    });

    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "DEBIT",
        amountMinor: 300n,
        memo: "Main till",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-penalty-receivable",
        direction: "CREDIT",
        amountMinor: 300n,
        memo: "Penalties",
      },
    ]);
    expect(
      (captures.journalLines as Array<{ accountId: string }>).some(
        (line) => line.accountId === "ledger-penalty-income",
      ),
    ).toBe(false);
    expectBalanced(captures.journalLines);
  });

  it("keeps unassessed or historical penalties on the penalty income account", async () => {
    const { prisma, captures } = buildPrismaMock();

    await postRepayment(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      amountMinor: 300n,
      settlementAccountId: "settlement-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "repayment-2",
    });

    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "DEBIT",
        amountMinor: 300n,
        memo: "Main till",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-penalty-income",
        direction: "CREDIT",
        amountMinor: 300n,
        memo: "Penalties",
      },
    ]);
    expectBalanced(captures.journalLines);
  });

  it("credits accrued interest to the receivable account instead of interest income", async () => {
    const { prisma, captures } = buildPrismaMock({
      interestAccruedOn: new Date("2026-09-04T00:00:00.000Z"),
      installment: { penaltiesDueMinor: 0n, interestDueMinor: 2_000n },
    });

    await postRepayment(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      amountMinor: 2_000n,
      settlementAccountId: "settlement-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "repayment-interest-accrued",
    });

    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "DEBIT",
        amountMinor: 2_000n,
        memo: "Main till",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-interest-receivable",
        direction: "CREDIT",
        amountMinor: 2_000n,
        memo: "Interest",
      },
    ]);
    expect(
      (captures.journalLines as Array<{ accountId: string }>).some(
        (line) => line.accountId === "ledger-interest-income",
      ),
    ).toBe(false);
    expectBalanced(captures.journalLines);
  });

  it("keeps unaccrued or historical interest on the interest income account", async () => {
    const { prisma, captures } = buildPrismaMock({
      installment: { penaltiesDueMinor: 0n, interestDueMinor: 2_000n },
    });

    await postRepayment(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      amountMinor: 2_000n,
      settlementAccountId: "settlement-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "repayment-interest-unaccrued",
    });

    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "DEBIT",
        amountMinor: 2_000n,
        memo: "Main till",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-interest-income",
        direction: "CREDIT",
        amountMinor: 2_000n,
        memo: "Interest",
      },
    ]);
    expectBalanced(captures.journalLines);
  });

  it("keeps exact-payoff repayments unchanged and closes the loan with no savings sweep", async () => {
    const { prisma, captures } = buildPrismaMock({
      installment: {
        principalDueMinor: 1_000n,
        penaltiesDueMinor: 0n,
      },
    });

    await postRepayment(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      amountMinor: 1_000n,
      settlementAccountId: "settlement-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "repayment-exact-1",
    });

    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "DEBIT",
        amountMinor: 1_000n,
        memo: "Main till",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-principal",
        direction: "CREDIT",
        amountMinor: 1_000n,
        memo: "Principal",
      },
    ]);
    expect(captures.savingsTransactions).toHaveLength(0);
    expect(captures.loanUpdates).toContainEqual({ status: "CLOSED" });
    expectBalanced(captures.journalLines);
  });

  it("sweeps repayment overpayments into an active savings account and closes the loan", async () => {
    const { prisma, captures } = buildPrismaMock({
      installment: {
        principalDueMinor: 27_500n,
        penaltiesDueMinor: 0n,
      },
      activeSavingsAccounts: [
        {
          id: "savings-1",
          accountNumber: "SV-0001",
          isDefault: true,
        },
      ],
    });

    await postRepayment(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      amountMinor: 28_000n,
      settlementAccountId: "settlement-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      externalReference: "finishing payment",
      idempotencyKey: "repayment-overpay-1",
    });

    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "DEBIT",
        amountMinor: 28_000n,
        memo: "Main till",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-principal",
        direction: "CREDIT",
        amountMinor: 27_500n,
        memo: "Principal",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-savings-liability",
        direction: "CREDIT",
        amountMinor: 500n,
        memo: "SV-0001",
      },
    ]);
    expect(captures.savingsTransactions).toHaveLength(1);
    expect(captures.savingsTransactions[0]).toMatchObject({
      savingsAccountId: "savings-1",
      transactionType: "DEPOSIT",
      amountMinor: 500n,
      settlementAccountId: "settlement-1",
      reason: "Loan overpayment sweep - LN-0001",
      externalReference: "finishing payment",
      idempotencyKey: "loan-overpayment:loan-tx-1:savings-credit",
    });
    expect(captures.loanUpdates).toContainEqual({ status: "CLOSED" });
    expectBalanced(captures.journalLines);
  });

  it("falls back to the overpayment liability account when no active savings account exists", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { prisma, captures } = buildPrismaMock({
      installment: {
        principalDueMinor: 27_500n,
        penaltiesDueMinor: 0n,
      },
    });

    await postRepayment(prisma, {
      loanId: "loan-1",
      actorUserId: "operator-1",
      amountMinor: 28_000n,
      settlementAccountId: "settlement-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "repayment-overpay-no-savings-1",
    });

    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-cash",
        direction: "DEBIT",
        amountMinor: 28_000n,
        memo: "Main till",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-principal",
        direction: "CREDIT",
        amountMinor: 27_500n,
        memo: "Principal",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-overpayment",
        direction: "CREDIT",
        amountMinor: 500n,
        memo: "Overpayment",
      },
    ]);
    expect(captures.savingsTransactions).toHaveLength(0);
    expect(captures.loanUpdates).toContainEqual({ status: "OVERPAID" });
    expect(warn).toHaveBeenCalledOnce();
    expectBalanced(captures.journalLines);
    warn.mockRestore();
  });

  it("rejects repayment when the office's accounting period is closed on/before the businessDate", async () => {
    const { prisma, transaction } = buildPrismaMock({});
    (transaction.accountingClosure.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ closingDate: new Date("2026-09-09T00:00:00.000Z") });

    await expect(
      postRepayment(prisma, {
        loanId: "loan-1",
        actorUserId: "operator-1",
        amountMinor: 1_000n,
        settlementAccountId: "settlement-1",
        businessDate: new Date("2026-09-09T00:00:00.000Z"),
        idempotencyKey: "repayment-closed-period-1",
      }),
    ).rejects.toThrow("closed on or before");
  });
});

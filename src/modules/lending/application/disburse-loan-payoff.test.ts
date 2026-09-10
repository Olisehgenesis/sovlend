import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { transferSavingsToLoan } = vi.hoisted(() => ({
  transferSavingsToLoan: vi.fn(async (_prisma: unknown, command: { loanId: string; amountMinor: bigint }) => ({
    id: "payoff-tx-1",
    loanId: command.loanId,
    transactionType: "REPAYMENT",
    settlementAmountMinor: command.amountMinor,
  })),
}));

vi.mock("@/modules/lending/application/post-repayment", () => ({
  transferSavingsToLoan,
}));

import { disburseLoanAndPayOffPrevious } from "./disburse-loan";

function installment(overrides: Partial<Record<string, bigint>> = {}) {
  return {
    principalDueMinor: 100_000n,
    interestDueMinor: 0n,
    feesDueMinor: 0n,
    penaltiesDueMinor: 0n,
    monitoringFeeDueMinor: 0n,
    principalPaidMinor: 0n,
    interestPaidMinor: 0n,
    feesPaidMinor: 0n,
    penaltiesPaidMinor: 0n,
    monitoringFeePaidMinor: 0n,
    principalWaivedMinor: 0n,
    interestWaivedMinor: 0n,
    feesWaivedMinor: 0n,
    penaltiesWaivedMinor: 0n,
    monitoringFeeWaivedMinor: 0n,
    ...overrides,
  };
}

type MockOptions = Readonly<{
  targetLoanOutstandingMinor: bigint;
  netProceedsMinor: bigint;
}>;

function buildPrismaMock(options: MockOptions) {
  const loan = {
    id: "loan-new",
    clientId: "client-1",
    groupId: null,
    officeId: "office-1",
    accountNumber: "LN-0002",
    status: "APPROVED",
    disbursedOn: null,
    principalMinor: options.netProceedsMinor,
    denominationCurrency: "UGX",
    termsSnapshot: {
      annualRateBps: 1_200,
      monitoringFeeAnnualRateBps: 0,
      repaymentCount: 1,
      repaymentFrequency: "MONTHLY",
      interestMethod: "FLAT",
    },
    application: { submittedById: "maker-1", approvals: [{ reviewerId: "checker-1" }] },
    product: {
      accountingMapping: {
        principalReceivableAccountId: "ledger-principal",
        feeIncomeAccountId: "ledger-fee-income",
        admissionFeeIncomeAccountId: null,
        processingFeeIncomeAccountId: null,
      },
    },
    office: { organizationId: "org-1" },
  };

  const targetLoan = {
    id: "loan-old",
    status: "ACTIVE",
    principalWrittenOffMinor: 0n,
    interestWrittenOffMinor: 0n,
    feesWrittenOffMinor: 0n,
    penaltiesWrittenOffMinor: 0n,
    installments: [installment({ principalDueMinor: options.targetLoanOutstandingMinor })],
  };

  const savingsAccount = { id: "savings-1", accountNumber: "SV-0001", isDefault: true, product: { id: "sp-1", shortName: "MSA" } };

  const transaction = {
    loan: { updateMany: vi.fn(async () => ({ count: 1 })) },
    charge: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    savingsAccount: {
      findMany: vi.fn(async () => [savingsAccount]),
      findUniqueOrThrow: vi.fn(async () => ({
        id: savingsAccount.id,
        accountNumber: savingsAccount.accountNumber,
        clientId: "client-1",
        groupId: null,
        currencyCode: "UGX",
        status: "ACTIVE",
        client: { organizationId: "org-1" },
        group: null,
        transactions: [{ amountMinor: 0n }],
      })),
    },
    ledgerAccount: { findFirst: vi.fn(async () => ({ id: "ledger-savings-liability" })) },
    savingsProductAccountingMapping: { findUnique: vi.fn(async () => null) },
    savingsAccountingDefaults: { findUnique: vi.fn(async () => null) },
    loanInstallment: { createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) },
    loanTransaction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "loan-tx-1", ...data })),
      findUnique: vi.fn(async () => null),
    },
    savingsTransaction: { findUnique: vi.fn(async () => null), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "savings-tx-1", ...data })) },
    journal: { create: vi.fn(async () => ({ id: "journal-1" })), update: vi.fn(async () => ({ id: "journal-1", status: "POSTED" })) },
    journalLine: { createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) },
    auditEvent: { create: vi.fn(async () => ({})) },
    outboxEvent: { create: vi.fn(async () => ({})) },
  };

  const prisma = {
    loanTransaction: { findUnique: vi.fn(async () => null) },
    loan: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === targetLoan.id ? targetLoan : loan)),
      findFirst: vi.fn(async () => ({ status: "ACTIVE" })),
    },
    user: { findUnique: vi.fn(async () => ({ systemRole: "LOAN_OFFICER" })) },
    savingsAccount: { findMany: transaction.savingsAccount.findMany },
    savingsTransaction: {
      findUnique: vi.fn(async () => ({ savingsAccountId: savingsAccount.id })),
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    accountingClosure: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaClient;

  return { prisma };
}

describe("disburseLoanAndPayOffPrevious", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing extra when no loan is selected to pay off", async () => {
    const { prisma } = buildPrismaMock({ targetLoanOutstandingMinor: 50_000n, netProceedsMinor: 200_000n });

    const result = await disburseLoanAndPayOffPrevious(prisma, {
      loanId: "loan-new",
      actorUserId: "operator-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "8f1a1a1a-0000-4000-8000-000000000001",
    });

    expect(result.payoff).toBeNull();
    expect(transferSavingsToLoan).not.toHaveBeenCalled();
  });

  it("pays off the previous loan in full and leaves the rest available when proceeds exceed the old balance", async () => {
    const { prisma } = buildPrismaMock({ targetLoanOutstandingMinor: 50_000n, netProceedsMinor: 200_000n });

    const result = await disburseLoanAndPayOffPrevious(prisma, {
      loanId: "loan-new",
      actorUserId: "operator-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "8f1a1a1a-0000-4000-8000-000000000002",
      topUpOfLoanId: "loan-old",
    });

    expect(transferSavingsToLoan).toHaveBeenCalledTimes(1);
    expect(transferSavingsToLoan).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ loanId: "loan-old", amountMinor: 50_000n, savingsAccountId: "savings-1" }),
    );
    expect(result.payoff?.settlementAmountMinor).toBe(50_000n);
  });

  it("caps the payoff at the net proceeds when the old loan owes more than was disbursed", async () => {
    const { prisma } = buildPrismaMock({ targetLoanOutstandingMinor: 500_000n, netProceedsMinor: 120_000n });

    const result = await disburseLoanAndPayOffPrevious(prisma, {
      loanId: "loan-new",
      actorUserId: "operator-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "8f1a1a1a-0000-4000-8000-000000000003",
      topUpOfLoanId: "loan-old",
    });

    expect(transferSavingsToLoan).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ loanId: "loan-old", amountMinor: 120_000n }),
    );
    expect(result.payoff?.settlementAmountMinor).toBe(120_000n);
  });

  it("skips the payoff transfer when the selected loan has nothing outstanding", async () => {
    const { prisma } = buildPrismaMock({ targetLoanOutstandingMinor: 0n, netProceedsMinor: 200_000n });

    const result = await disburseLoanAndPayOffPrevious(prisma, {
      loanId: "loan-new",
      actorUserId: "operator-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "8f1a1a1a-0000-4000-8000-000000000004",
      topUpOfLoanId: "loan-old",
    });

    expect(transferSavingsToLoan).not.toHaveBeenCalled();
    expect(result.payoff).toBeNull();
  });
});

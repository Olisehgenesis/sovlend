import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { transferSavingsToLoan } from "./post-repayment";

function buildPrismaMock() {
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
    principalDueMinor: 1_000n,
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
    penaltyAssessedOn: null,
  };

  const captures: { journalLines: unknown[]; savingsTransactions: unknown[] } = {
    journalLines: [],
    savingsTransactions: [],
  };

  const savingsAccount = {
    id: "savings-1",
    accountNumber: "SV-0001",
    clientId: "client-1",
    groupId: null,
    productId: "product-1",
    status: "ACTIVE",
    currencyCode: "UGX",
    client: { organizationId: "org-1", officeId: "office-1" },
    group: null,
    product: { shortName: "MSA" },
    transactions: [{ amountMinor: 2_000n }],
  };

  const transaction = {
    loan: {
      findUniqueOrThrow: vi.fn(async () => ({
        ...loan,
        installments: [installment],
        product: {
          accountingMapping: {
            principalReceivableAccountId: "ledger-principal",
            interestIncomeAccountId: "ledger-interest-income",
            feeIncomeAccountId: "ledger-fee-income",
            monitoringFeeIncomeAccountId: "ledger-monitoring-income",
            penaltyIncomeAccountId: "ledger-penalty-income",
            penaltyReceivableAccountId: "ledger-penalty-receivable",
            overpaymentLiabilityAccountId: "ledger-overpayment",
          },
        },
        office: { organizationId: "org-1" },
      })),
      update: vi.fn(async () => ({})),
    },
    loanTransaction: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "loan-tx-1", ...data })),
    },
    loanInstallment: { update: vi.fn(async () => ({})) },
    loanTransactionAllocation: { create: vi.fn(async () => ({})) },
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
      findUniqueOrThrow: vi.fn(async () => savingsAccount),
    },
    savingsTransaction: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.savingsTransactions.push(data);
        return { id: "savings-tx-1", ...data };
      }),
    },
    savingsProductAccountingMapping: { findUnique: vi.fn(async () => null) },
    savingsAccountingDefaults: { findUnique: vi.fn(async () => null) },
    ledgerAccount: {
      findFirst: vi.fn(async () => ({ id: "ledger-savings-liability" })),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    outboxEvent: { create: vi.fn(async () => ({})) },
  };

  const prisma = {
    loanTransaction: { findUnique: vi.fn(async () => null) },
    loan: { findUnique: vi.fn(async () => loan) },
    savingsAccount: { findUnique: vi.fn(async () => savingsAccount) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;

  return { prisma, captures };
}

describe("transferSavingsToLoan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("debits the savings liability account and credits loan principal, with no settlement account", async () => {
    const { prisma, captures } = buildPrismaMock();

    await transferSavingsToLoan(prisma, {
      loanId: "loan-1",
      savingsAccountId: "savings-1",
      actorUserId: "operator-1",
      amountMinor: 1_000n,
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      idempotencyKey: "transfer-1",
    });

    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-savings-liability",
        direction: "DEBIT",
        amountMinor: 1_000n,
        memo: "Savings SV-0001",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-principal",
        direction: "CREDIT",
        amountMinor: 1_000n,
        memo: "Principal",
      },
    ]);

    expect(captures.savingsTransactions).toHaveLength(1);
    const savingsTx = captures.savingsTransactions[0] as { transactionType: string; amountMinor: bigint; settlementAccountId?: string };
    expect(savingsTx.transactionType).toBe("WITHDRAWAL");
    expect(savingsTx.amountMinor).toBe(-1_000n);
    expect(savingsTx.settlementAccountId).toBeUndefined();
  });

  it("rejects a transfer that exceeds the available savings balance", async () => {
    const { prisma } = buildPrismaMock();

    await expect(
      transferSavingsToLoan(prisma, {
        loanId: "loan-1",
        savingsAccountId: "savings-1",
        actorUserId: "operator-1",
        amountMinor: 5_000n,
        businessDate: new Date("2026-09-09T00:00:00.000Z"),
        idempotencyKey: "transfer-2",
      }),
    ).rejects.toThrow("Transfer exceeds the available savings balance");
  });

  it("rejects when the savings account and loan belong to different clients", async () => {
    const { prisma } = buildPrismaMock();
    (prisma.savingsAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "savings-1",
      clientId: "someone-else",
      groupId: null,
      status: "ACTIVE",
      currencyCode: "UGX",
    });

    await expect(
      transferSavingsToLoan(prisma, {
        loanId: "loan-1",
        savingsAccountId: "savings-1",
        actorUserId: "operator-1",
        amountMinor: 500n,
        businessDate: new Date("2026-09-09T00:00:00.000Z"),
        idempotencyKey: "transfer-3",
      }),
    ).rejects.toThrow("Savings account and loan must belong to the same client or group");
  });
});

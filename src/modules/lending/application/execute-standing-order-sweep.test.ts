import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import {
  executeStandingOrderSweep,
  listStandingOrderSweepJobs,
} from "./execute-standing-order-sweep";
import {
  STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME,
  STANDING_ORDER_SYSTEM_EMAIL,
} from "@/modules/lending/domain/standing-order-sweep-constants";

function buildPrismaMock() {
  const sweepSettlementAccount = {
    id: "settlement-sweep-1",
    name: STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME,
    ledgerAccountId: "ledger-savings-liability",
  };

  const loan = {
    id: "loan-1",
    officeId: "office-1",
    clientId: "client-1",
    accountNumber: "LN-0001",
    status: "ACTIVE",
    denominationCurrency: "UGX",
    office: { organizationId: "org-1" },
  };

  const installment = {
    id: "installment-1",
    dueOn: new Date("2026-09-01T00:00:00.000Z"),
    installmentNumber: 1,
    principalDueMinor: 100_000n,
    interestDueMinor: 20_000n,
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
  };

  const savingsAccountRow = {
    id: "savings-1",
    accountNumber: "SV-0001",
    clientId: "client-1",
    status: "ACTIVE",
    currencyCode: "UGX",
    transactions: [{ amountMinor: 500_000n }],
  };

  const captures: {
    journalCreateCalls: unknown[];
    journalLineBatches: unknown[][];
    savingsTransactionData: Record<string, unknown> | null;
  } = { journalCreateCalls: [], journalLineBatches: [], savingsTransactionData: null };

  let journalSequence = 0;
  const transaction = {
    loan: {
      findUnique: vi.fn(async () => ({
        ...loan,
        installments: [installment],
        client: { mobileNumber: null },
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        ...loan,
        installments: [installment],
        product: {
          accountingMapping: {
            principalReceivableAccountId: "ledger-principal",
            interestIncomeAccountId: "ledger-interest-income",
            feeIncomeAccountId: "ledger-fee-income",
            penaltyIncomeAccountId: "ledger-penalty-income",
            overpaymentLiabilityAccountId: "ledger-overpayment",
          },
        },
        office: { organizationId: "org-1" },
      })),
      update: vi.fn(async () => ({})),
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
      findFirst: vi.fn(async () => sweepSettlementAccount),
    },
    savingsAccount: {
      findUnique: vi.fn(async () => savingsAccountRow),
      findUniqueOrThrow: vi.fn(async () => ({
        id: savingsAccountRow.id,
        accountNumber: savingsAccountRow.accountNumber,
        clientId: "client-1",
        groupId: null,
        productId: "savings-product-1",
        currencyCode: "UGX",
        status: "ACTIVE",
        client: { organizationId: "org-1", officeId: "office-1" },
        group: null,
        product: { shortName: "MSA" },
        transactions: savingsAccountRow.transactions,
      })),
    },
    savingsTransaction: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.savingsTransactionData = data;
        return { id: "savings-tx-1", ...data };
      }),
    },
    savingsProductAccountingMapping: { findUnique: vi.fn(async () => null) },
    savingsAccountingDefaults: { findUnique: vi.fn(async () => null) },
    ledgerAccount: {
      findFirst: vi.fn(async () => ({ id: "ledger-savings-liability-fallback" })),
    },
    journal: {
      create: vi.fn(async () => {
        journalSequence += 1;
        const id = `journal-${journalSequence}`;
        captures.journalCreateCalls.push({ id });
        return { id };
      }),
      update: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        status: "POSTED",
      })),
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
  };

  const prisma = {
    loanTransaction: { findUnique: vi.fn(async () => null) },
    loan: { findUnique: vi.fn(async () => loan) },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) =>
        where.email === STANDING_ORDER_SYSTEM_EMAIL ? { id: "system-user-1" } : null,
      ),
    },
    settlementAccount: { findFirst: vi.fn(async () => sweepSettlementAccount) },
    notification: { upsert: vi.fn(async () => ({ id: "notification-1" })) },
    reminder: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;

  return { prisma, captures };
}

describe("executeStandingOrderSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts exactly one balanced journal for the combined repayment + savings-withdrawal legs", async () => {
    const { prisma, captures } = buildPrismaMock();

    const result = await executeStandingOrderSweep(
      prisma,
      {
        requestKey: "standing-order-sweep:loan-1:daily:2026-09-09",
        loanId: "loan-1",
        installmentId: "installment-1",
        clientId: "client-1",
        savingsAccountId: "savings-1",
        accountNumber: "LN-0001",
        dueOn: "2026-09-01T00:00:00.000Z",
        outstandingMinor: "120000",
        currencyCode: "UGX",
        mobileNumber: null,
      },
      new Date("2026-09-09T08:00:00.000Z"),
    );

    expect(result).toEqual({ outcome: "swept", amountMinor: 120_000n });
    expect(captures.journalCreateCalls).toHaveLength(1);
    expect(captures.journalLineBatches).toHaveLength(1);

    const lines = captures.journalLineBatches[0] as Array<{
      accountId: string;
      direction: "DEBIT" | "CREDIT";
      amountMinor: bigint;
    }>;
    expect(() =>
      assertBalancedJournal(lines.map((line) => ({ ...line, currencyCode: "UGX" }))),
    ).not.toThrow();

    const totalDebits = lines
      .filter((line) => line.direction === "DEBIT")
      .reduce((sum, line) => sum + line.amountMinor, 0n);
    const totalCredits = lines
      .filter((line) => line.direction === "CREDIT")
      .reduce((sum, line) => sum + line.amountMinor, 0n);
    expect(totalDebits).toBe(120_000n);
    expect(totalCredits).toBe(120_000n);
    expect(
      lines.some(
        (line) => line.accountId === "ledger-savings-liability" && line.direction === "DEBIT",
      ),
    ).toBe(true);

    expect(captures.savingsTransactionData).toMatchObject({
      savingsAccountId: "savings-1",
      transactionType: "WITHDRAWAL",
      amountMinor: -120_000n,
      settlementAccountId: "settlement-sweep-1",
    });
  });
});

describe("listStandingOrderSweepJobs", () => {
  it("prefers the explicitly supplied savings account over the client's default", async () => {
    const prisma = {
      loan: {
        findMany: vi.fn(async () => [
          {
            id: "loan-1",
            clientId: "client-1",
            accountNumber: "LN-0001",
            denominationCurrency: "UGX",
            installments: [
              {
                id: "installment-1",
                dueOn: new Date("2026-09-09T00:00:00.000Z"),
                principalDueMinor: 80_000n,
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
              },
            ],
            client: {
              mobileNumber: "0700000000",
              savingsAccounts: [
                { id: "default-savings", isDefault: true, currencyCode: "UGX" },
                { id: "deposit-savings", isDefault: false, currencyCode: "UGX" },
              ],
            },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const jobs = await listStandingOrderSweepJobs(prisma, {
      now: new Date("2026-09-09T08:00:00.000Z"),
      clientId: "client-1",
      preferredSavingsAccountId: "deposit-savings",
      buildRequestKey: (loanId) => `standing-order-sweep:${loanId}:deposit:savings-tx-1`,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      savingsAccountId: "deposit-savings",
      outstandingMinor: "80000",
    });
  });
});

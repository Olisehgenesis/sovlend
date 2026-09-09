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
}>;

function buildPrismaMock(options: MockOptions = {}) {
  const loan = {
    id: "loan-1",
    officeId: "office-1",
    accountNumber: "LN-0001",
    status: "ACTIVE",
    denominationCurrency: "UGX",
    office: { organizationId: "org-1" },
  };

  const installment = {
    id: "installment-1",
    dueOn: new Date("2026-09-01T00:00:00.000Z"),
    installmentNumber: 1,
    principalDueMinor: 0n,
    interestDueMinor: 0n,
    feesDueMinor: 0n,
    penaltiesDueMinor: 300n,
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
    penaltyAssessedOn: options.penaltyAssessedOn ?? null,
  };

  const captures: { journalLines: unknown[] } = { journalLines: [] };

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
    auditEvent: { create: vi.fn(async () => ({})) },
    outboxEvent: { create: vi.fn(async () => ({})) },
  };

  const prisma = {
    loanTransaction: { findUnique: vi.fn(async () => null) },
    loan: { findUnique: vi.fn(async () => loan) },
    settlementAccount: { findFirst: vi.fn(async () => ({ id: "settlement-1", name: "Main till", ledgerAccountId: "ledger-cash" })) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;

  return { prisma, captures };
}

describe("postRepayment penalty routing", () => {
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
    expect(() =>
      assertBalancedJournal(
        (captures.journalLines as Array<{
          accountId: string;
          direction: "DEBIT" | "CREDIT";
          amountMinor: bigint;
        }>).map((line) => ({ ...line, currencyCode: "UGX" })),
      ),
    ).not.toThrow();
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
  });
});

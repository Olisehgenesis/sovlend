import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

import { assessLoanPenalties } from "./assess-loan-penalties";

type MockOptions = Readonly<{
  businessDate?: Date;
  dueOn?: Date;
  lateFeeRule?: Record<string, unknown> | null;
  penaltyAssessedOn?: Date | null;
  penaltyIncomeAccountId?: string | null;
  penaltyReceivableAccountId?: string | null;
  updateCount?: number;
  closureDate?: Date | null;
}>;

function buildPrismaMock(options: MockOptions = {}) {
  const businessDate = options.businessDate ?? new Date("2026-09-09T00:00:00.000Z");
  const dueOn = options.dueOn ?? new Date("2026-09-07T00:00:00.000Z");
  const captures: Record<string, unknown> = {
    loanInstallmentUpdateArgs: null,
    journalCreateData: null,
    journalLines: [],
    auditEventData: null,
    outboxEventData: null,
  };

  const installment = {
    id: "installment-1",
    installmentNumber: 1,
    dueOn,
    penaltyAssessedOn: options.penaltyAssessedOn ?? null,
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

  const loan = {
    id: "loan-1",
    officeId: "office-1",
    accountNumber: "LN-0001",
    denominationCurrency: "UGX",
    product: {
      lateFeeRule:
        options.lateFeeRule === undefined
          ? {
              graceDays: 2,
              calculationType: "FLAT",
              amountMinor: "1500",
            }
          : options.lateFeeRule,
      accountingMapping: {
        penaltyIncomeAccountId:
          options.penaltyIncomeAccountId === undefined
            ? "ledger-penalty-income"
            : options.penaltyIncomeAccountId,
        penaltyReceivableAccountId:
          options.penaltyReceivableAccountId === undefined
            ? "ledger-penalty-receivable"
            : options.penaltyReceivableAccountId,
      },
    },
    installments: [installment],
  };

  const transaction = {
    loanInstallment: {
      updateMany: vi.fn(async (args: unknown) => {
        captures.loanInstallmentUpdateArgs = args;
        return { count: options.updateCount ?? 1 };
      }),
    },
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
    accountingClosure: {
      findFirst: vi.fn(async () => (options.closureDate ? { closingDate: options.closureDate } : null)),
    },
  };

  const prisma = {
    loan: {
      findMany: vi.fn(async () => [loan]),
    },
    $transaction: vi.fn(
      async (callback: (tx: typeof transaction) => unknown, _options?: unknown) => callback(transaction),
    ),
  } as unknown as PrismaClient;

  return { prisma, captures, businessDate };
}

describe("assessLoanPenalties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assesses an installment crossing grace today and posts a balanced journal", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      dueOn: new Date("2026-09-07T00:00:00.000Z"),
    });

    const result = await assessLoanPenalties(prisma, { businessDate });

    expect(result.assessedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(captures.loanInstallmentUpdateArgs).toMatchObject({
      where: { id: "installment-1", penaltyAssessedOn: null },
      data: {
        penaltiesDueMinor: { increment: 1_500n },
        penaltyAssessedOn: new Date("2026-09-09T00:00:00.000Z"),
      },
    });
    expect(captures.journalCreateData).toMatchObject({
      officeId: "office-1",
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      referenceType: "LOAN_PENALTY_ASSESSMENT",
      referenceId: "installment-1",
      idempotencyKey: "penalty-assessment:installment-1",
    });
    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-penalty-receivable",
        direction: "DEBIT",
        amountMinor: 1_500n,
        memo: "Penalty receivable",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-penalty-income",
        direction: "CREDIT",
        amountMinor: 1_500n,
        memo: "Penalty income",
      },
    ]);
    expect(() =>
      assertBalancedJournal(
        (captures.journalLines as Array<{
          accountId: string;
          direction: "DEBIT" | "CREDIT";
          amountMinor: bigint;
        }>).map((line) => ({ ...line, currencyCode: "UGX" })),
      ),
    ).not.toThrow();
    expect(captures.auditEventData).toMatchObject({
      actorId: null,
      action: "loan.penalty.assessed",
      entityType: "LoanInstallment",
      entityId: "installment-1",
    });
    expect(captures.outboxEventData).toMatchObject({
      aggregateType: "Loan",
      aggregateId: "loan-1",
      eventType: "loan.penalty.assessed",
    });
  });

  it("never retroactively assesses installments whose grace crossing is far in the past", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      dueOn: new Date("2026-08-31T00:00:00.000Z"),
    });

    const result = await assessLoanPenalties(prisma, { businessDate });

    expect(result.assessedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toContain("outside the one-time penalty assessment window");
    expect(captures.loanInstallmentUpdateArgs).toBeNull();
    expect(captures.journalCreateData).toBeNull();
  });

  it("skips (does not crash the batch) an installment whose office accounting period is closed", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      dueOn: new Date("2026-09-07T00:00:00.000Z"),
      closureDate: new Date("2026-09-09T00:00:00.000Z"),
    });

    const result = await assessLoanPenalties(prisma, { businessDate });

    expect(result.assessedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toMatch(/accounting period/i);
    expect(captures.journalCreateData).toBeNull();
  });

  it("skips installments already assessed by a prior or concurrent transaction", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      dueOn: new Date("2026-09-07T00:00:00.000Z"),
      updateCount: 0,
    });

    const result = await assessLoanPenalties(prisma, { businessDate });

    expect(result.assessedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toContain("already assessed");
    expect(captures.journalCreateData).toBeNull();
  });

  it("skips instead of crashing when required accounting mappings are missing", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      penaltyReceivableAccountId: null,
    });

    const result = await assessLoanPenalties(prisma, { businessDate });

    expect(result.assessedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toContain("Penalty receivable or penalty income account");
    expect(captures.loanInstallmentUpdateArgs).toBeNull();
    expect(captures.journalCreateData).toBeNull();
  });
});

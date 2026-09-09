import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

import { assessLoanInterestAccruals } from "./assess-loan-interest-accruals";

type MockOptions = Readonly<{
  businessDate?: Date;
  dueOn?: Date;
  interestAccruedOn?: Date | null;
  interestDueMinor?: bigint;
  interestPaidMinor?: bigint;
  interestWaivedMinor?: bigint;
  interestIncomeAccountId?: string | null;
  interestReceivableAccountId?: string | null;
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
    interestAccruedOn: options.interestAccruedOn ?? null,
    interestDueMinor: options.interestDueMinor ?? 20_000n,
    interestPaidMinor: options.interestPaidMinor ?? 0n,
    interestWaivedMinor: options.interestWaivedMinor ?? 0n,
  };

  const loan = {
    id: "loan-1",
    officeId: "office-1",
    accountNumber: "LN-0001",
    denominationCurrency: "UGX",
    product: {
      accountingMapping: {
        interestIncomeAccountId:
          options.interestIncomeAccountId === undefined ? "ledger-interest-income" : options.interestIncomeAccountId,
        interestReceivableAccountId:
          options.interestReceivableAccountId === undefined
            ? "ledger-interest-receivable"
            : options.interestReceivableAccountId,
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

describe("assessLoanInterestAccruals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accrues an installment's outstanding interest on its due date and posts a balanced journal", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-07T00:00:00.000Z"),
      dueOn: new Date("2026-09-07T00:00:00.000Z"),
    });

    const result = await assessLoanInterestAccruals(prisma, { businessDate });

    expect(result.accruedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(captures.loanInstallmentUpdateArgs).toMatchObject({
      where: { id: "installment-1", interestAccruedOn: null },
      data: { interestAccruedOn: new Date("2026-09-07T00:00:00.000Z") },
    });
    expect(captures.journalCreateData).toMatchObject({
      officeId: "office-1",
      businessDate: new Date("2026-09-07T00:00:00.000Z"),
      referenceType: "LOAN_INTEREST_ACCRUAL",
      referenceId: "installment-1",
      idempotencyKey: "interest-accrual:installment-1",
    });
    expect(captures.journalLines).toEqual([
      {
        journalId: "journal-1",
        accountId: "ledger-interest-receivable",
        direction: "DEBIT",
        amountMinor: 20_000n,
        memo: "Interest receivable",
      },
      {
        journalId: "journal-1",
        accountId: "ledger-interest-income",
        direction: "CREDIT",
        amountMinor: 20_000n,
        memo: "Interest income",
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
      action: "loan.interest.accrued",
      entityType: "LoanInstallment",
      entityId: "installment-1",
    });
    expect(captures.outboxEventData).toMatchObject({
      aggregateType: "Loan",
      aggregateId: "loan-1",
      eventType: "loan.interest.accrued",
    });
  });

  it("never retroactively accrues installments whose due date is far in the past", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      dueOn: new Date("2026-08-31T00:00:00.000Z"),
    });

    const result = await assessLoanInterestAccruals(prisma, { businessDate });

    expect(result.accruedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toContain("outside the one-time interest accrual window");
    expect(captures.loanInstallmentUpdateArgs).toBeNull();
    expect(captures.journalCreateData).toBeNull();
  });

  it("does not accrue before the installment is due", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-05T00:00:00.000Z"),
      dueOn: new Date("2026-09-07T00:00:00.000Z"),
    });

    const result = await assessLoanInterestAccruals(prisma, { businessDate });

    expect(result.accruedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(captures.journalCreateData).toBeNull();
  });

  it("skips (does not crash the batch) an installment whose office accounting period is closed", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      dueOn: new Date("2026-09-07T00:00:00.000Z"),
      closureDate: new Date("2026-09-09T00:00:00.000Z"),
    });

    const result = await assessLoanInterestAccruals(prisma, { businessDate });

    expect(result.accruedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toMatch(/accounting period/i);
    expect(captures.journalCreateData).toBeNull();
  });

  it("skips installments already accrued by a prior or concurrent transaction", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-09T00:00:00.000Z"),
      dueOn: new Date("2026-09-07T00:00:00.000Z"),
      updateCount: 0,
    });

    const result = await assessLoanInterestAccruals(prisma, { businessDate });

    expect(result.accruedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toContain("already accrued");
    expect(captures.journalCreateData).toBeNull();
  });

  it("skips instead of crashing when required accounting mappings are missing", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      interestReceivableAccountId: null,
    });

    const result = await assessLoanInterestAccruals(prisma, { businessDate });

    expect(result.accruedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toContain("Interest receivable or interest income account");
    expect(captures.loanInstallmentUpdateArgs).toBeNull();
    expect(captures.journalCreateData).toBeNull();
  });

  it("skips an installment whose interest is already fully collected", async () => {
    const { prisma, captures, businessDate } = buildPrismaMock({
      businessDate: new Date("2026-09-07T00:00:00.000Z"),
      dueOn: new Date("2026-09-07T00:00:00.000Z"),
      interestDueMinor: 20_000n,
      interestPaidMinor: 20_000n,
    });

    const result = await assessLoanInterestAccruals(prisma, { businessDate });

    expect(result.accruedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0]?.reason).toContain("already fully collected or waived");
    expect(captures.journalCreateData).toBeNull();
  });
});

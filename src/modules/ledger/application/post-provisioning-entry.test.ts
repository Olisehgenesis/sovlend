import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { postProvisioningEntry } from "./post-provisioning-entry";

type MockLoanOptions = Readonly<{
  dueOn?: Date;
  principalDueMinor?: bigint;
}>;

function buildLoan(options: MockLoanOptions = {}) {
  return {
    id: "loan-1",
    accountNumber: "LN-0001",
    status: "IN_ARREARS",
    principalMinor: options.principalDueMinor ?? 100_000n,
    denominationCurrency: "UGX",
    officeId: "office-1",
    disbursedOn: new Date("2025-01-01T00:00:00.000Z"),
    maturesOn: new Date("2027-01-01T00:00:00.000Z"),
    office: { name: "Head Office" },
    product: { name: "Standard Loan", annualRateBps: 2400 },
    termsSnapshot: null,
    loanOfficerId: null,
    loanOfficer: null,
    client: { firstName: "Jane", middleName: null, lastName: "Doe" },
    group: null,
    installments: [
      {
        dueOn: options.dueOn ?? new Date("2026-01-01T00:00:00.000Z"),
        principalDueMinor: options.principalDueMinor ?? 100_000n,
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
  };
}

type MockOptions = Readonly<{
  loans?: ReturnType<typeof buildLoan>[];
  existingPosting?: unknown;
  priorPosting?: { requiredProvisionMinor: bigint } | null;
  defaults?: { provisionExpenseAccountId: string | null; loanLossProvisionAccountId: string | null } | null;
  closureDate?: Date | null;
}>;

function buildPrisma(options: MockOptions = {}) {
  const captures: Record<string, unknown> = {
    journalCreateData: null,
    journalLines: [],
    postingCreateData: null,
    auditEventData: null,
    outboxEventData: null,
  };

  const tx = {
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
    provisioningPosting: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.postingCreateData = data;
        return { id: "posting-1", ...data };
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
  };

  const defaults =
    options.defaults === null
      ? null
      : options.defaults ?? { provisionExpenseAccountId: "ledger-provision-expense", loanLossProvisionAccountId: "ledger-loan-loss-provision" };

  const prisma = {
    office: { findFirst: vi.fn(async () => ({ id: "office-1", organizationId: "org-1", name: "Head Office" })) },
    provisioningPosting: {
      findUnique: vi.fn(async () => options.existingPosting ?? null),
      findFirst: vi.fn(async () => options.priorPosting ?? null),
    },
    provisioningAccountingDefaults: { findUnique: vi.fn(async () => defaults) },
    accountingClosure: { findFirst: vi.fn(async () => (options.closureDate ? { closingDate: options.closureDate } : null)) },
    loan: { findMany: vi.fn(async () => options.loans ?? [buildLoan()]) },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;

  return { prisma, captures };
}

const baseCommand = {
  organizationId: "org-1",
  officeId: "office-1",
  actorUserId: "user-1",
  asOfDate: new Date("2026-09-09T00:00:00.000Z"),
};

describe("postProvisioningEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the full required provision as the delta when there is no prior posting", async () => {
    const { prisma, captures } = buildPrisma();

    const result = await postProvisioningEntry(prisma, baseCommand);

    expect(result.alreadyPosted).toBe(false);
    expect(result.posting.previousProvisionMinor).toBe(0n);
    expect(result.posting.requiredProvisionMinor).toBe(100_000n);
    expect(result.posting.deltaMinor).toBe(100_000n);
    expect(captures.journalCreateData).toMatchObject({
      officeId: "office-1",
      referenceType: "LOAN_LOSS_PROVISION",
      idempotencyKey: "provisioning-entry:office-1:2026-09-09",
    });
    expect(captures.journalLines).toEqual([
      { journalId: "journal-1", accountId: "ledger-provision-expense", direction: "DEBIT", amountMinor: 100_000n, memo: "Provision expense" },
      { journalId: "journal-1", accountId: "ledger-loan-loss-provision", direction: "CREDIT", amountMinor: 100_000n, memo: "Loan loss provision" },
    ]);
  });

  it("posts only the incremental change since the last posting", async () => {
    const { prisma, captures } = buildPrisma({ priorPosting: { requiredProvisionMinor: 60_000n } });

    const result = await postProvisioningEntry(prisma, baseCommand);

    expect(result.posting.previousProvisionMinor).toBe(60_000n);
    expect(result.posting.deltaMinor).toBe(40_000n);
    expect(captures.journalLines).toEqual([
      { journalId: "journal-1", accountId: "ledger-provision-expense", direction: "DEBIT", amountMinor: 40_000n, memo: "Provision expense" },
      { journalId: "journal-1", accountId: "ledger-loan-loss-provision", direction: "CREDIT", amountMinor: 40_000n, memo: "Loan loss provision" },
    ]);
  });

  it("posts a reversing entry when the required provision has decreased", async () => {
    const { prisma, captures } = buildPrisma({ priorPosting: { requiredProvisionMinor: 150_000n } });

    const result = await postProvisioningEntry(prisma, baseCommand);

    expect(result.posting.deltaMinor).toBe(-50_000n);
    expect(captures.journalLines).toEqual([
      { journalId: "journal-1", accountId: "ledger-loan-loss-provision", direction: "DEBIT", amountMinor: 50_000n, memo: "Loan loss provision release" },
      { journalId: "journal-1", accountId: "ledger-provision-expense", direction: "CREDIT", amountMinor: 50_000n, memo: "Provision expense release" },
    ]);
  });

  it("records a zero-delta evaluation without posting a journal", async () => {
    const { prisma, captures } = buildPrisma({ priorPosting: { requiredProvisionMinor: 100_000n } });

    const result = await postProvisioningEntry(prisma, baseCommand);

    expect(result.posting.deltaMinor).toBe(0n);
    expect(result.posting.journalId).toBeNull();
    expect(captures.journalCreateData).toBeNull();
  });

  it("is idempotent for the same office and asOfDate", async () => {
    const existingPosting = {
      id: "posting-existing",
      requiredProvisionMinor: 100_000n,
      previousProvisionMinor: 0n,
      deltaMinor: 100_000n,
      journalId: "journal-existing",
    };
    const { prisma, captures } = buildPrisma({ existingPosting });

    const result = await postProvisioningEntry(prisma, baseCommand);

    expect(result.alreadyPosted).toBe(true);
    expect(result.posting).toEqual(existingPosting);
    expect(captures.journalCreateData).toBeNull();
  });

  it("throws when the provisioning accounting defaults are not configured", async () => {
    const { prisma } = buildPrisma({ defaults: null });

    await expect(postProvisioningEntry(prisma, baseCommand)).rejects.toThrow(
      "Provisioning expense and loan loss provision accounts are not configured",
    );
  });

  it("rejects posting when the office's accounting period is closed on/before the asOfDate", async () => {
    const { prisma, captures } = buildPrisma({ closureDate: new Date("2026-09-09T00:00:00.000Z") });

    await expect(postProvisioningEntry(prisma, baseCommand)).rejects.toThrow(/accounting period/i);
    expect(captures.journalCreateData).toBeNull();
  });
});

import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class AuthorizationService {
    async assertAllowed() {}
  },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

import { approveLoanApplication } from "./approve-loan-application";

type MockOptions = Readonly<{
  actorSystemRole: "ADMIN" | "GENERAL_MANAGER" | "BRANCH_MANAGER" | "LOAN_OFFICER";
  actorUserId: string;
  submittedById: string;
  guarantors?: unknown;
  returningDraft?: boolean;
}>;

function buildPrismaMock({ actorSystemRole, actorUserId, submittedById, guarantors, returningDraft }: MockOptions) {
  const captures: Record<string, unknown> = {
    approvalData: null,
    loanData: null,
    loanApplicationUpdateArgs: null,
  };

  const application = {
    id: "8e60336a-4498-4cf7-9f8f-5f80b4e79357",
    status: "SUBMITTED",
    applicationExpiresOn: null as Date | null,
    submittedById,
    officeId: "office-1",
    clientId: "client-1",
    groupId: null,
    productId: "product-1",
    loanOfficerId: actorUserId,
    fundId: null,
    termsSnapshot: null,
    chargesSnapshot: null,
    collateralSnapshot: null as unknown,
    guarantorsSnapshot: guarantors ?? null,
    updatedAt: new Date("2026-10-07T00:00:00Z"),
    loan: returningDraft ? { id: "draft-loan", status: "DRAFT", disbursedOn: null, termsSnapshot: { lifExempt: true }, updatedAt: new Date("2026-10-07"), accountNumber: "EXISTING-L4", collateralItems: [] as { id: string; type: string; description: string | null; _count: { documents: number; notes: number } }[] } : null,
    office: {
      organizationId: "org-1",
    },
    product: {
      denominationCurrency: "UGX",
      principalMinMinor: 100_000n,
      principalMaxMinor: 1_000_000n,
      annualRateBps: 2_400,
      monitoringFeeAnnualRateBps: 0,
      processingFeeBps: 500,
      repaymentCount: 12,
      repaymentFrequency: "MONTHLY",
      amortizationMethod: "EQUAL_INSTALLMENTS",
      interestMethod: "DECLINING_BALANCE",
      version: 3,
    },
  };

  const transaction = {
    loanApplication: {
      updateMany: vi.fn(async (args: unknown) => {
        captures.loanApplicationUpdateArgs = args;
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ id: application.id, status: "APPROVED" })),
    },
    approval: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.approvalData = data;
        return { id: "approval-1", ...data };
      }),
    },
    loan: {
      updateMany: vi.fn(async ({ data }: { data: unknown }) => { captures.loanData = data; return { count: 1 }; }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.loanData = data;
        return { id: "loan-1", ...data };
      }),
    },
    charge: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    loanCollateral: {
      createMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    guarantor: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async ({ data }: { data: unknown }) => { captures.guarantorData = data; return { count: 1 }; }) },
    guarantorProfile: { findMany: vi.fn(async () => (guarantors ?? []) as { id: string; firstName: string; lastName: string; phone: string; relationship: string; dateOfBirth: Date; clientId?: string }[]) },
    auditEvent: {
      create: vi.fn(async () => ({})),
    },
    outboxEvent: {
      create: vi.fn(async () => ({})),
    },
  };

  const loanApplicationFindUnique = vi.fn(async () => application);

  const prisma = {
    loanApplication: {
      findUnique: loanApplicationFindUnique,
    },
    user: {
      findUnique: vi.fn(async () => ({ systemRole: actorSystemRole })),
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;

  return { prisma, captures, loanApplicationFindUnique, transaction };
}

describe("approveLoanApplication", () => {
  it("reapproves the same draft loan number instead of creating another account", async () => {
    const { prisma, captures, transaction } = buildPrismaMock({ actorSystemRole: "BRANCH_MANAGER", actorUserId: "reviewer", submittedById: "maker", returningDraft: true });
    await approveLoanApplication(prisma, { applicationId: "app", actorUserId: "reviewer", approvedPrincipalMinor: 450000n });
    expect(captures.loanData).toMatchObject({ accountNumber: "EXISTING-L4", status: "APPROVED", principalMinor: 450000n, termsSnapshot: { lifExempt: true } });
    expect(transaction.loan.create).not.toHaveBeenCalled();
    expect(transaction.approval.create).toHaveBeenCalledOnce();
    expect(transaction.charge.deleteMany).toHaveBeenCalledWith({ where: { loanId: "draft-loan", status: "PENDING" } });
    expect(transaction.guarantor.deleteMany).toHaveBeenCalledWith({ where: { loanId: "draft-loan" } });
  });
  it("rejects a stale draft loan and does not replace its guarantees", async () => {
    const { prisma, transaction } = buildPrismaMock({ actorSystemRole: "BRANCH_MANAGER", actorUserId: "reviewer", submittedById: "maker", returningDraft: true });
    transaction.loan.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(approveLoanApplication(prisma, { applicationId: "app", actorUserId: "reviewer", approvedPrincipalMinor: 450000n })).rejects.toThrow("Draft loan changed");
    expect(transaction.guarantor.deleteMany).not.toHaveBeenCalled();
  });
  it("keeps collateral IDs and evidence and rejects removal of documented collateral", async () => {
    const { prisma, transaction, loanApplicationFindUnique } = buildPrismaMock({ actorSystemRole: "BRANCH_MANAGER", actorUserId: "reviewer", submittedById: "maker", returningDraft: true });
    const original = await loanApplicationFindUnique();
    const loan = { ...original.loan!, collateralItems: [{ id: "collateral", type: "Land", description: "Plot", _count: { documents: 1, notes: 1 } }] };
    loanApplicationFindUnique.mockResolvedValueOnce({ ...original, loan, collateralSnapshot: [{ type: "Land", description: "Plot", estimatedValueMinor: "1000000" }] });
    await approveLoanApplication(prisma, { applicationId: "app", actorUserId: "reviewer", approvedPrincipalMinor: 450000n });
    expect(transaction.loanCollateral.update).toHaveBeenCalledWith({ where: { id: "collateral" }, data: { type: "Land", description: "Plot", estimatedValueMinor: 1000000n, valuationCurrencyCode: "UGX" } });
    expect(transaction.loanCollateral.delete).not.toHaveBeenCalled();
    loanApplicationFindUnique.mockResolvedValueOnce({ ...original, loan });
    await expect(approveLoanApplication(prisma, { applicationId: "app", actorUserId: "reviewer", approvedPrincipalMinor: 450000n })).rejects.toThrow("Collateral with documents or notes");
    expect(transaction.loanCollateral.delete).not.toHaveBeenCalled();
  });
  it("copies reviewed guarantors to the approved loan and checks the reviewed version", async () => {
    const { prisma, captures } = buildPrismaMock({
      actorSystemRole: "BRANCH_MANAGER", actorUserId: "reviewer", submittedById: "maker",
      guarantors: [{ id: "profile-1", clientId: "client-2", firstName: "Jane", lastName: "Doe", phone: "0700000000", relationship: "Sister", dateOfBirth: new Date("1990-01-01T00:00:00Z") }],
    });
    await approveLoanApplication(prisma, { applicationId: "application", actorUserId: "reviewer", approvedPrincipalMinor: 450_000n });
    expect(captures.guarantorData).toEqual([{ loanId: "loan-1", profileId: "profile-1", guarantorType: "EXISTING_CLIENT", firstName: "Jane", lastName: "Doe", phone: "0700000000", relationship: "Sister", dateOfBirth: new Date("1990-01-01T00:00:00Z") }]);
    expect(captures.loanApplicationUpdateArgs).toMatchObject({ where: { updatedAt: new Date("2026-10-07T00:00:00Z") } });
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a branch manager to approve their own submitted application", async () => {
    const { prisma, captures } = buildPrismaMock({
      actorSystemRole: "BRANCH_MANAGER",
      actorUserId: "branch-manager-1",
      submittedById: "branch-manager-1",
    });

    const application = await approveLoanApplication(prisma, {
      applicationId: "8e60336a-4498-4cf7-9f8f-5f80b4e79357",
      actorUserId: "branch-manager-1",
      approvedPrincipalMinor: 450_000n,
      reason: "Approved at branch level",
    });

    expect(application).toEqual({ id: "8e60336a-4498-4cf7-9f8f-5f80b4e79357", status: "APPROVED" });
    expect(captures.loanApplicationUpdateArgs).toMatchObject({
      where: { id: "8e60336a-4498-4cf7-9f8f-5f80b4e79357", status: "SUBMITTED" },
      data: { status: "APPROVED", approvedPrincipalMinor: 450_000n },
    });
    expect(captures.approvalData).toMatchObject({
      applicationId: "8e60336a-4498-4cf7-9f8f-5f80b4e79357",
      reviewerId: "branch-manager-1",
      decision: "APPROVED",
      reason: "Approved at branch level",
    });
    expect(captures.loanData).toMatchObject({
      applicationId: "8e60336a-4498-4cf7-9f8f-5f80b4e79357",
      clientId: "client-1",
      productId: "product-1",
      officeId: "office-1",
      loanOfficerId: "branch-manager-1",
      principalMinor: 450_000n,
      status: "APPROVED",
      termsSnapshot: { processingFeeBps: 500 },
    });
  });

  it("keeps loan officers blocked from approving their own submitted application", async () => {
    const { prisma } = buildPrismaMock({
      actorSystemRole: "LOAN_OFFICER",
      actorUserId: "loan-officer-1",
      submittedById: "loan-officer-1",
    });

    await expect(
      approveLoanApplication(prisma, {
        applicationId: "8e60336a-4498-4cf7-9f8f-5f80b4e79357",
        actorUserId: "loan-officer-1",
        approvedPrincipalMinor: 450_000n,
      }),
    ).rejects.toThrow("Maker-checker violation: submitter cannot approve this application");
  });

  it("still lets an authorized reviewer approve after the application expiry date", async () => {
    const { prisma, loanApplicationFindUnique } = buildPrismaMock({
      actorSystemRole: "BRANCH_MANAGER",
      actorUserId: "branch-manager-1",
      submittedById: "loan-officer-1",
    });

    loanApplicationFindUnique.mockResolvedValueOnce({
      id: "8e60336a-4498-4cf7-9f8f-5f80b4e79357",
      status: "SUBMITTED",
      applicationExpiresOn: new Date("2026-09-07T00:00:00.000Z"),
      submittedById: "loan-officer-1",
      officeId: "office-1",
      clientId: "client-1",
      groupId: null,
      productId: "product-1",
      loanOfficerId: "branch-manager-1",
      fundId: null,
      termsSnapshot: null,
      chargesSnapshot: null,
      collateralSnapshot: null,
      guarantorsSnapshot: null,
      updatedAt: new Date("2026-10-07T00:00:00Z"),
      loan: null,
      office: {
        organizationId: "org-1",
      },
      product: {
        processingFeeBps: 500,
        denominationCurrency: "UGX",
        principalMinMinor: 100_000n,
        principalMaxMinor: 1_000_000n,
        annualRateBps: 2_400,
        monitoringFeeAnnualRateBps: 0,
        repaymentCount: 12,
        repaymentFrequency: "MONTHLY",
        amortizationMethod: "EQUAL_INSTALLMENTS",
        interestMethod: "DECLINING_BALANCE",
        version: 3,
      },
    });

    await expect(
      approveLoanApplication(prisma, {
        applicationId: "8e60336a-4498-4cf7-9f8f-5f80b4e79357",
        actorUserId: "branch-manager-1",
        approvedPrincipalMinor: 450_000n,
      }),
    ).resolves.toEqual({ id: "8e60336a-4498-4cf7-9f8f-5f80b4e79357", status: "APPROVED" });
  });
});

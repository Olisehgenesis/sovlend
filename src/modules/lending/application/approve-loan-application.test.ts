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
}>;

function buildPrismaMock({ actorSystemRole, actorUserId, submittedById }: MockOptions) {
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
    collateralSnapshot: null,
    office: {
      organizationId: "org-1",
    },
    product: {
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
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        captures.loanData = data;
        return { id: "loan-1", ...data };
      }),
    },
    charge: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    loanCollateral: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
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

  return { prisma, captures, loanApplicationFindUnique };
}

describe("approveLoanApplication", () => {
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

  it("blocks approval after the application expiry date passes", async () => {
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
      office: {
        organizationId: "org-1",
      },
      product: {
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
    ).rejects.toThrow("expired on 2026-09-07");
  });
});

import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const allowed = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class { isAllowed = allowed; },
  PermissionDeniedError: class extends Error {},
}));

import { deleteLoanApplication, rejectLoanApplication } from "./loan-application-decision";

const scope = { organizationId: "org", officeIds: ["office"], officerUserId: null };
const updatedAt = new Date("2026-10-27T10:00:00.000Z");
const command = { applicationId: "app", actorUserId: "actor", reason: "Entered on the wrong client", expectedUpdatedAt: updatedAt };

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "app",
    officeId: "office",
    status: "SUBMITTED",
    submittedById: "maker",
    externalId: null,
    updatedAt,
    proposedPrincipalMinor: 20000000n,
    product: { denominationCurrency: "UGX" },
    loan: null,
    ...overrides,
  };
}

function mock(current = application()) {
  const tx = {
    loanApplication: {
      findFirst: vi.fn(async () => current),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(async () => ({})),
    },
    approval: { create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) },
    auditEvent: { create: vi.fn(async () => ({})) },
    journal: { count: vi.fn(async () => 0) },
    document: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    charge: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    loan: { delete: vi.fn(async () => ({})) },
    guarantorDocument: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    guarantorProfile: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
  const db = {
    user: { findUnique: vi.fn(async () => ({ systemRole: "LOAN_OFFICER", organizationId: "org", banned: false })) },
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaClient;
  return { current, tx, db };
}

describe("rejecting a submitted loan application", () => {
  beforeEach(() => { allowed.mockReset(); allowed.mockResolvedValue(true); });

  it("keeps the application and records the rejection", async () => {
    const { db, tx } = mock();
    expect(await rejectLoanApplication(db, scope, command)).toEqual({ applicationId: "app" });
    expect(tx.loanApplication.updateMany).toHaveBeenCalledWith({ where: { id: "app", status: "SUBMITTED", updatedAt }, data: { status: "REJECTED" } });
    expect(tx.approval.create).toHaveBeenCalledWith({ data: { applicationId: "app", reviewerId: "actor", decision: "REJECTED", reason: command.reason } });
    expect(tx.loanApplication.delete).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ permission: "LOAN_APPROVE", officeId: "office", amountMinor: 20000000n, currencyCode: "UGX" }));
  });

  it("blocks the submitter, a stale review, and anything that is not awaiting approval", async () => {
    const own = mock(application({ submittedById: "actor" }));
    await expect(rejectLoanApplication(own.db, scope, command)).rejects.toThrow("cannot reject");
    expect(own.tx.loanApplication.updateMany).not.toHaveBeenCalled();

    const stale = mock();
    stale.tx.loanApplication.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(rejectLoanApplication(stale.db, scope, command)).rejects.toThrow("Refresh");
    expect(stale.tx.approval.create).not.toHaveBeenCalled();

    const approved = mock(application({ status: "APPROVED" }));
    await expect(rejectLoanApplication(approved.db, scope, command)).rejects.toThrow("submitted");
  });
});

describe("deleting an undisbursed loan", () => {
  beforeEach(() => { allowed.mockReset(); allowed.mockResolvedValue(true); });

  it("removes a submitted application that has no loan account", async () => {
    const { db, tx } = mock();
    expect(await deleteLoanApplication(db, scope, command)).toEqual({ applicationId: "app", loanId: null });
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(tx.loan.delete).not.toHaveBeenCalled();
    expect(tx.guarantorProfile.deleteMany).toHaveBeenCalledWith({ where: { applicationId: "app" } });
    expect(tx.loanApplication.delete).toHaveBeenCalledWith({ where: { id: "app" } });
    expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ permission: "LOAN_APPLICATION_CREATE" }));
  });

  it("removes an approved loan only after its paperwork and pending charges", async () => {
    const loan = {
      id: "loan", accountNumber: "000000926L", status: "APPROVED", disbursedOn: null, principalMinor: 300000000n,
      denominationCurrency: "UGX", principalWrittenOffMinor: 0n, charges: [{ status: "PENDING" }],
      _count: { transactions: 0, installments: 0, topUpLoans: 0, reminders: 0 },
    };
    const { db, tx } = mock(application({ status: "APPROVED", loan }));
    expect(await deleteLoanApplication(db, scope, command)).toEqual({ applicationId: "app", loanId: "loan" });
    expect(tx.journal.count).toHaveBeenCalledWith({ where: { referenceId: { in: ["loan", "app"] } } });
    expect(tx.document.deleteMany).toHaveBeenCalled();
    expect(tx.charge.deleteMany).toHaveBeenCalledWith({ where: { loanId: "loan", status: "PENDING" } });
    expect(tx.loan.delete).toHaveBeenCalledWith({ where: { id: "loan" } });
    expect(tx.loanApplication.delete).toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ permission: "LOAN_APPROVE", amountMinor: 300000000n }));
  });

  it("keeps disbursed loans, loans with payments, and loans with journals", async () => {
    const baseLoan = {
      id: "loan", accountNumber: "000000926L", status: "APPROVED", disbursedOn: null as Date | null, principalMinor: 1n,
      denominationCurrency: "UGX", principalWrittenOffMinor: 0n, charges: [] as { status: string }[],
      _count: { transactions: 0, installments: 0, topUpLoans: 0, reminders: 0 },
    };
    const disbursed = mock(application({ status: "DISBURSED", loan: { ...baseLoan, disbursedOn: new Date(), status: "ACTIVE" } }));
    await expect(deleteLoanApplication(disbursed.db, scope, command)).rejects.toThrow("Disbursed");
    expect(disbursed.tx.loan.delete).not.toHaveBeenCalled();

    const paid = mock(application({ status: "APPROVED", loan: { ...baseLoan, _count: { ...baseLoan._count, transactions: 1 } } }));
    await expect(deleteLoanApplication(paid.db, scope, command)).rejects.toThrow("financial history");

    const posted = mock(application({ status: "APPROVED", loan: baseLoan }));
    posted.tx.journal.count.mockResolvedValueOnce(1);
    await expect(deleteLoanApplication(posted.db, scope, command)).rejects.toThrow("accounting entries");
    expect(posted.tx.loan.delete).not.toHaveBeenCalled();
  });

  it("refuses a stale application and an unauthorized officer", async () => {
    const stale = mock();
    stale.tx.loanApplication.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(deleteLoanApplication(stale.db, scope, command)).rejects.toThrow("Refresh");
    expect(stale.tx.loanApplication.delete).not.toHaveBeenCalled();

    allowed.mockResolvedValueOnce(false);
    const denied = mock();
    await expect(deleteLoanApplication(denied.db, scope, command)).rejects.toThrow("cannot delete");
    expect(denied.tx.auditEvent.create).not.toHaveBeenCalled();
  });
});

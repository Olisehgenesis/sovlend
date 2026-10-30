import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const allowed = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class { isAllowed = allowed; },
  PermissionDeniedError: class extends Error {},
}));
import { returnLoanToReview } from "./return-loan-to-review";
const scope = { organizationId: "org", officeIds: ["office"], officerUserId: null };
const command = { loanId: "loan", actorUserId: "actor", reason: "Send back for review", expectedUpdatedAt: new Date("2026-10-07") };
function mock(name = "Robinah Nakaggwe") {
  const loan = { id: "loan", applicationId: "app", officeId: "office", status: "APPROVED", disbursedOn: null as Date | null, principalMinor: 300000000n, denominationCurrency: "UGX", termsSnapshot: { processingFeeBps: 600 }, application: { status: "APPROVED", updatedAt: new Date("2026-10-07") }, charges: [] as { status: string }[], transactions: [] as { id: string; transactionType: string; reversedById: string | null }[], _count: { installments: 0 } };
  const tx = {
    loan: { findFirst: vi.fn(async () => loan), updateMany: vi.fn(async () => ({ count: 1 })) },
    loanApplication: { updateMany: vi.fn(async () => ({ count: 1 })) },
    approval: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditEvent: { create: vi.fn(async () => ({})) },
  };
  return { loan, tx, db: {
    user: { findUnique: vi.fn(async () => ({ name, systemRole: "LOAN_OFFICER", organizationId: "org", banned: false })) },
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaClient };
}
describe("returning an undisbursed loan to review", () => {
  beforeEach(() => { allowed.mockReset(); allowed.mockResolvedValue(false); });
  it("moves the application back to review and keeps the loan number", async () => {
    const { db, tx } = mock();
    expect(await returnLoanToReview(db, scope, command)).toEqual({ applicationId: "app" });
    expect(tx.loan.updateMany).toHaveBeenCalledWith({ where: { id: "loan", status: "APPROVED", disbursedOn: null, updatedAt: command.expectedUpdatedAt }, data: { status: "DRAFT" } });
    expect(tx.loanApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "SUBMITTED", approvedAt: null, approvedPrincipalMinor: null, proposedPrincipalMinor: 300000000n, termsSnapshot: { processingFeeBps: 600 } },
    }));
    expect(tx.approval.updateMany).toHaveBeenCalledWith({ where: { applicationId: "app", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(allowed).not.toHaveBeenCalled();
  });
  it("blocks financial history and previously disbursed loans", async () => {
    const { db, loan } = mock();
    loan.disbursedOn = new Date();
    await expect(returnLoanToReview(db, scope, command)).rejects.toThrow("undisbursed");
    loan.disbursedOn = null;
    loan.transactions = [{ id: "pay", transactionType: "REPAYMENT", reversedById: null }];
    await expect(returnLoanToReview(db, scope, command)).rejects.toThrow("financial history");
    loan.transactions = [{ id: "out", transactionType: "DISBURSEMENT", reversedById: null }];
    await expect(returnLoanToReview(db, scope, command)).rejects.toThrow("financial history");
    loan.transactions = [];
    loan.charges = [{ status: "PAID" }];
    await expect(returnLoanToReview(db, scope, command)).rejects.toThrow("financial history");
  });
  it("accepts a payout that was fully reversed", async () => {
    const { db, loan } = mock();
    loan.transactions = [
      { id: "out", transactionType: "DISBURSEMENT", reversedById: "back" },
      { id: "back", transactionType: "DISBURSEMENT_REVERSAL", reversedById: null },
    ];
    loan.charges = [{ status: "WAIVED" }, { status: "PENDING" }];
    expect(await returnLoanToReview(db, scope, command)).toEqual({ applicationId: "app" });
  });
  it("rejects other officers who lack approval permission", async () => {
    const { db, tx } = mock("Jane Officer");
    await expect(returnLoanToReview(db, scope, command)).rejects.toThrow("cannot return");
    expect(tx.loan.updateMany).not.toHaveBeenCalled();
  });
});

import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const allowed = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class { isAllowed = allowed; },
  PermissionDeniedError: class extends Error {},
}));
import { returnLoanToDraft } from "./return-loan-to-draft";
const scope = { organizationId: "org", officeIds: ["office"], officerUserId: null };
const command = { loanId: "loan", actorUserId: "actor", reason: "Correct terms", expectedUpdatedAt: new Date("2026-10-07") };
function mock() {
  const loan = { id: "loan", applicationId: "app", officeId: "office", status: "APPROVED", disbursedOn: null as Date | null, principalMinor: 300000000n, denominationCurrency: "UGX", termsSnapshot: { processingFeeBps: 600 }, application: { status: "APPROVED", updatedAt: new Date("2026-10-07") }, charges: [] as { status: string }[], _count: { transactions: 0, installments: 0 } };
  const tx = {
    loan: { findFirst: vi.fn(async () => loan), updateMany: vi.fn(async () => ({ count: 1 })) },
    loanApplication: { updateMany: vi.fn(async () => ({ count: 1 })) },
    approval: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditEvent: { create: vi.fn(async () => ({})) },
  };
  return { loan, tx, db: {
    user: { findUnique: vi.fn(async () => ({ systemRole: "LOAN_OFFICER", organizationId: "org", banned: false })) },
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaClient };
}
describe("returning an undisbursed loan to draft", () => {
  beforeEach(() => { allowed.mockReset(); allowed.mockResolvedValue(true); });
  it("revokes approval without deleting history and preserves loan terms", async () => {
    const { db, tx } = mock();
    expect(await returnLoanToDraft(db, scope, command)).toEqual({ applicationId: "app" });
    expect(tx.loan.updateMany).toHaveBeenCalledWith({ where: { id: "loan", status: "APPROVED", disbursedOn: null, updatedAt: command.expectedUpdatedAt }, data: { status: "DRAFT" } });
    expect(tx.loanApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "DRAFT", approvedAt: null, approvedPrincipalMinor: null, proposedPrincipalMinor: 300000000n, termsSnapshot: { processingFeeBps: 600 } } }));
    expect(tx.approval.updateMany).toHaveBeenCalledWith({ where: { applicationId: "app", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ permission: "LOAN_APPROVE", officeId: "office", amountMinor: 300000000n }));
  });
  it("uses organization and office scope", async () => {
    const { db, tx } = mock(); tx.loan.findFirst.mockResolvedValueOnce(null as never);
    await expect(returnLoanToDraft(db, scope, command)).rejects.toThrow("not found");
    expect(tx.loan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "loan", office: { organizationId: "org" }, officeId: { in: ["office"] } } }));
  });
  it("blocks financial history and previously disbursed loans", async () => {
    for (const field of ["transactions", "installments"] as const) {
      const { db, loan, tx } = mock(); loan._count[field] = 1;
      await expect(returnLoanToDraft(db, scope, command)).rejects.toThrow("financial history");
      expect(tx.loan.updateMany).not.toHaveBeenCalled();
    }
    const { db, loan } = mock(); loan.disbursedOn = new Date();
    await expect(returnLoanToDraft(db, scope, command)).rejects.toThrow("undisbursed");
  });
  it("blocks stale edits and unauthorized returns", async () => {
    const { db, tx } = mock(); tx.loan.updateMany.mockResolvedValue({ count: 0 });
    await expect(returnLoanToDraft(db, scope, command)).rejects.toThrow("Refresh");
    expect(tx.approval.updateMany).not.toHaveBeenCalled();
    allowed.mockResolvedValueOnce(false);
    await expect(returnLoanToDraft(db, scope, command)).rejects.toThrow("cannot return");
  });
  it("rejects charge history and an application changed during the return", async () => {
    const { db, tx, loan } = mock();
    loan.charges = [{ status: "PAID" }];
    await expect(returnLoanToDraft(db, scope, command)).rejects.toThrow("financial history");
    expect(tx.loan.updateMany).not.toHaveBeenCalled();
    loan.charges = [];
    tx.loanApplication.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(returnLoanToDraft(db, scope, command)).rejects.toThrow("Application changed");
    expect(tx.approval.updateMany).not.toHaveBeenCalled();
  });
});

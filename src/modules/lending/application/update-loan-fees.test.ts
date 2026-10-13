import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const allowed = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/modules/identity/application/authorization-service", () => ({ AuthorizationService: class { assertAllowed = allowed; } }));
import { updateLoanFees } from "./update-loan-fees";
const scope = { organizationId: "org", officeIds: ["office"], officerUserId: null };
const command = { loanId: "loan", actorUserId: "actor", processingFeeBps: 600, expectedUpdatedAt: new Date("2026-10-07") };
function mock() {
  const loan = { id: "loan", officeId: "office", status: "APPROVED", disbursedOn: null as Date | null, denominationCurrency: "UGX", principalMinor: 300000000n, termsSnapshot: { processingFeeBps: 200, annualRateBps: 2400 } };
  const tx = {
    loan: { findFirst: vi.fn(async () => loan), updateMany: vi.fn(async () => ({ count: 1 })) },
    auditEvent: { create: vi.fn(async () => ({})) },
  };
  const db = { $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)) } as unknown as PrismaClient;
  return { db, tx, loan };
}
describe("saving pre-disbursement loan fees", () => {
  beforeEach(() => allowed.mockReset());
  it("saves only the rate, preserves other terms, checks version, and audits", async () => {
    const { db, tx } = mock();
    await expect(updateLoanFees(db, scope, command)).resolves.toEqual({ processingFeeBps: 600 });
    expect(tx.loan.findFirst).toHaveBeenCalledWith({ where: { id: "loan", office: { organizationId: "org" }, officeId: { in: ["office"] } } });
    expect(allowed).toHaveBeenCalledWith({ actorUserId: "actor", permission: "LOAN_DISBURSE", organizationId: "org", officeId: "office", amountMinor: 300000000n, currencyCode: "UGX" });
    expect(tx.loan.updateMany).toHaveBeenCalledWith({
      where: { id: "loan", status: "APPROVED", disbursedOn: null, updatedAt: command.expectedUpdatedAt },
      data: { termsSnapshot: { processingFeeBps: 600, annualRateBps: 2400 } },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "loan.fees.updated", metadata: { loanId: "loan", beforeProcessingFeeBps: 200, processingFeeBps: 600 } }) }));
  });
  it.each(["ACTIVE", "CLOSED", "IN_ARREARS"])("locks %s loans", async (status) => {
    const { db, tx, loan } = mock(); loan.status = status;
    await expect(updateLoanFees(db, scope, command)).rejects.toThrow("before disbursement");
    expect(tx.loan.updateMany).not.toHaveBeenCalled();
  });
  it("rejects a stale edit without auditing success", async () => {
    const { db, tx } = mock(); tx.loan.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateLoanFees(db, scope, command)).rejects.toThrow("Refresh");
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
  it("requires permission", async () => {
    const { db, tx } = mock(); allowed.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(updateLoanFees(db, scope, command)).rejects.toThrow("Permission denied");
    expect(tx.loan.updateMany).not.toHaveBeenCalled();
  });
  it("rejects loans outside scope", async () => {
    const { db, tx } = mock(); tx.loan.findFirst.mockResolvedValueOnce(null as never);
    await expect(updateLoanFees(db, scope, command)).rejects.toThrow("not found");
  });
});

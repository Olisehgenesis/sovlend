import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const allowed = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/modules/identity/application/authorization-service", () => ({ AuthorizationService: class { assertAllowed = allowed; } }));

import { rescheduleLoanDates } from "./reschedule-loan-dates";

const scope = { organizationId: "org", officeIds: ["office"], officerUserId: null };
const updatedAt = new Date("2026-10-07T00:00:00.000Z");
const command = {
  loanId: "loan",
  actorUserId: "actor",
  reason: "Move the Tuesday dues onto Fridays",
  expectedUpdatedAt: updatedAt,
  businessDate: new Date("2026-10-21T12:00:00.000Z"),
  dates: [
    { id: "a", dueOn: "2026-11-06" },
    { id: "b", dueOn: "2026-11-13" },
  ],
};

function installment(id: string, installmentNumber: number, dueOn: string) {
  return {
    id,
    installmentNumber,
    dueOn: new Date(`${dueOn}T00:00:00.000Z`),
    principalDueMinor: 1_000n,
    interestDueMinor: 100n,
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
    penaltyAssessedOn: null,
    interestAccruedOn: null,
  };
}

function mock(status = "IN_ARREARS") {
  const loan = {
    id: "loan",
    officeId: "office",
    status,
    disbursedOn: new Date("2026-09-01T00:00:00.000Z"),
    installments: [installment("a", 1, "2026-10-06"), installment("b", 2, "2026-10-13")],
    transactions: [] as Array<{ transactionType: string; allocations: Array<{ installmentId: string; principalMinor: bigint; interestMinor: bigint; feesMinor: bigint; monitoringFeeMinor: bigint; penaltiesMinor: bigint }> }>,
  };
  const tx = {
    loan: { findFirst: vi.fn(async () => loan), updateMany: vi.fn(async () => ({ count: 1 })) },
    loanInstallment: { updateMany: vi.fn(async () => ({ count: 1 })) },
    charge: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditEvent: { create: vi.fn(async () => ({})) },
    loanNote: { create: vi.fn(async () => ({})) },
    outboxEvent: { create: vi.fn(async () => ({})) },
  };
  const db = { $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)) } as unknown as PrismaClient;
  return { db, tx, loan };
}

describe("rescheduleLoanDates", () => {
  beforeEach(() => allowed.mockReset());

  it("saves the admin's dates, follows them for arrears, and records the change", async () => {
    const { db, tx } = mock();
    await expect(rescheduleLoanDates(db, scope, command)).resolves.toEqual({
      status: "ACTIVE",
      maturesOn: "2026-11-13",
      changes: [
        { installmentNumber: 1, from: "2026-10-06", to: "2026-11-06" },
        { installmentNumber: 2, from: "2026-10-13", to: "2026-11-13" },
      ],
    });
    expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ permission: "LOAN_RESCHEDULE" }));
    expect(tx.loan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt, status: { in: ["ACTIVE", "IN_ARREARS"] } }),
      data: expect.objectContaining({ status: "ACTIVE", scheduleVersion: { increment: 1 } }),
    }));
    expect(tx.charge.updateMany).toHaveBeenCalledWith({
      where: { loanId: "loan", status: "PENDING", dueOn: new Date("2026-10-06T00:00:00.000Z") },
      data: { dueOn: new Date("2026-11-06T00:00:00.000Z") },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(tx.loanNote.create).toHaveBeenCalledOnce();
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it("leaves one installment in place and moves the other", async () => {
    const { db, tx } = mock();
    await rescheduleLoanDates(db, scope, { ...command, dates: [{ id: "b", dueOn: "2026-11-13" }] });
    expect(tx.loanInstallment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it("refuses a date that already has a payment", async () => {
    const { db, tx, loan } = mock();
    loan.transactions.push({
      transactionType: "REPAYMENT",
      allocations: [{ installmentId: "a", principalMinor: 10n, interestMinor: 0n, feesMinor: 0n, monitoringFeeMinor: 0n, penaltiesMinor: 0n }],
    });
    await expect(rescheduleLoanDates(db, scope, command)).rejects.toThrow("Payment already recorded");
    expect(tx.loan.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale edit", async () => {
    const { db, tx } = mock();
    tx.loan.updateMany.mockResolvedValue({ count: 0 });
    await expect(rescheduleLoanDates(db, scope, command)).rejects.toThrow("Refresh");
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});

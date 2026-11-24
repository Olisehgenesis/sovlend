import { describe, expect, it } from "vitest";

import { installmentDueVsPaid, installmentPaymentTiming } from "./repayment-timeliness";

const dueOn = new Date("2026-09-10T00:00:00.000Z");
const installment = {
  dueOn,
  principalDueMinor: 10_000n,
  interestDueMinor: 0n,
  feesDueMinor: 0n,
  penaltiesDueMinor: 0n,
  monitoringFeeDueMinor: 0n,
  principalPaidMinor: 10_000n,
  interestPaidMinor: 0n,
  feesPaidMinor: 0n,
  penaltiesPaidMinor: 0n,
  monitoringFeePaidMinor: 0n,
};

describe("installmentPaymentTiming", () => {
  it("distinguishes early, on-time, and late payments by the final payment date", () => {
    expect(installmentPaymentTiming(installment, [{ amountMinor: 10_000n, businessDate: new Date("2026-09-09T00:00:00.000Z") }], dueOn)).toBe("PAID_EARLY");
    expect(installmentPaymentTiming(installment, [{ amountMinor: 10_000n, businessDate: dueOn }], dueOn)).toBe("PAID_ON_TIME");
    expect(installmentPaymentTiming(installment, [{ amountMinor: 10_000n, businessDate: new Date("2026-09-11T00:00:00.000Z") }], dueOn)).toBe("PAID_LATE");
  });

  it("uses only the supplied payment evidence to mark completion", () => {
    expect(installmentPaymentTiming(installment, [], dueOn)).toBe("TIMING_UNAVAILABLE");
  });

  it("still classifies a settled installment whose evidence is short because charge payments or waivers covered the gap", () => {
    // Due 10,000: 4,000 came from a repayment, the rest was settled through a charge payment or
    // waiver that never created an installment allocation. The latest repayment (2 days late) is
    // the best settlement evidence, so this must read PAID_LATE, not "timing unavailable".
    const settledShort = { ...installment, principalPaidMinor: 10_000n };
    expect(
      installmentPaymentTiming(settledShort, [{ amountMinor: 4_000n, businessDate: new Date("2026-09-12T00:00:00.000Z") }], dueOn),
    ).toBe("PAID_LATE");
  });

  it("distinguishes overdue unpaid and partially paid installments", () => {
    const partial = { ...installment, principalPaidMinor: 5_000n };
    const now = new Date("2026-09-12T00:00:00.000Z");
    expect(installmentPaymentTiming({ ...partial, principalPaidMinor: 0n }, [], now)).toBe("OVERDUE");
    expect(installmentPaymentTiming(partial, [{ amountMinor: 5_000n, businessDate: now }], now)).toBe("PART_PAID_LATE");
  });

  it("does not call an installment overdue while its due date is still today", () => {
    expect(installmentPaymentTiming({ ...installment, principalPaidMinor: 0n }, [], new Date("2026-09-10T17:00:00.000Z"))).toBe("UPCOMING");
  });
});

describe("installmentDueVsPaid", () => {
  it("reports the paid date and signed days between due and paid for settled installments", () => {
    const paidOn = new Date("2026-09-13T00:00:00.000Z");
    expect(installmentDueVsPaid(installment, [{ amountMinor: 10_000n, businessDate: paidOn }], dueOn)).toEqual({
      timing: "PAID_LATE",
      paidOn,
      daysLate: 3,
    });
    expect(
      installmentDueVsPaid(installment, [{ amountMinor: 10_000n, businessDate: new Date("2026-09-08T00:00:00.000Z") }], dueOn),
    ).toEqual({ timing: "PAID_EARLY", paidOn: new Date("2026-09-08T00:00:00.000Z"), daysLate: -2 });
    expect(installmentDueVsPaid(installment, [{ amountMinor: 10_000n, businessDate: dueOn }], dueOn)).toEqual({
      timing: "PAID_ON_TIME",
      paidOn: dueOn,
      daysLate: 0,
    });
  });

  it("uses the latest of several partial payments as the settlement date", () => {
    const result = installmentDueVsPaid(
      installment,
      [
        { amountMinor: 4_000n, businessDate: new Date("2026-09-10T00:00:00.000Z") },
        { amountMinor: 6_000n, businessDate: new Date("2026-09-15T00:00:00.000Z") },
      ],
      dueOn,
    );
    expect(result).toEqual({ timing: "PAID_LATE", paidOn: new Date("2026-09-15T00:00:00.000Z"), daysLate: 5 });
  });

  it("counts days overdue so far while an installment stays unpaid or part-paid", () => {
    const now = new Date("2026-09-14T00:00:00.000Z");
    expect(installmentDueVsPaid({ ...installment, principalPaidMinor: 0n }, [], now)).toEqual({
      timing: "OVERDUE",
      paidOn: null,
      daysLate: 4,
    });
    const partPaid = installmentDueVsPaid(
      { ...installment, principalPaidMinor: 5_000n },
      [{ amountMinor: 5_000n, businessDate: new Date("2026-09-12T00:00:00.000Z") }],
      now,
    );
    expect(partPaid.timing).toBe("PART_PAID_LATE");
    expect(partPaid.paidOn).toEqual(new Date("2026-09-12T00:00:00.000Z"));
    expect(partPaid.daysLate).toBe(4);
  });

  it("returns null days for upcoming, waived, and evidence-free settled installments", () => {
    expect(installmentDueVsPaid({ ...installment, principalPaidMinor: 0n }, [], dueOn)).toEqual({
      timing: "UPCOMING",
      paidOn: null,
      daysLate: null,
    });
    expect(installmentDueVsPaid(installment, [], dueOn)).toEqual({
      timing: "TIMING_UNAVAILABLE",
      paidOn: null,
      daysLate: null,
    });
  });
});

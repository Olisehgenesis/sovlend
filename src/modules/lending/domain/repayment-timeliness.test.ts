import { describe, expect, it } from "vitest";

import { installmentPaymentTiming } from "./repayment-timeliness";

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

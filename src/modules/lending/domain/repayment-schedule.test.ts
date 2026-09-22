import { describe, expect, it } from "vitest";

import { generateRepaymentSchedule, INTEREST_DAY_COUNT, parseRepaymentFrequency, describeRepaymentCadence, readInterestDayCount } from "./repayment-schedule";

describe("repayment schedule", () => {
  it("preserves every principal minor unit for flat weekly loans", () => {
    const schedule = generateRepaymentSchedule({ principalMinor: 70_000_000n, annualRateBps: 3360, repaymentCount: 20, repaymentFrequency: "1 Weeks", interestMethod: "Flat", disbursedOn: new Date("2026-09-02T00:00:00Z") });
    expect(schedule).toHaveLength(20);
    expect(schedule.reduce((sum, item) => sum + item.principalDueMinor, 0n)).toBe(70_000_000n);
    expect(schedule.reduce((sum, item) => sum + item.interestDueMinor, 0n)).toBe(9_021_370n);
    expect(schedule.every((item) => item.feesDueMinor === 0n)).toBe(true);
    expect(schedule[0].dueOn.toISOString().slice(0, 10)).toBe("2026-09-09");
    expect(schedule[19].dueOn.toISOString().slice(0, 10)).toBe("2027-01-20");
  });

  it("keeps Actual/365 weekly interest unless a new loan opts into four-week months", () => {
    const terms = {
      principalMinor: 100_000_000n,
      annualRateBps: 3360,
      repaymentCount: 24,
      repaymentFrequency: "1 Weeks",
      interestMethod: "Flat" as const,
      disbursedOn: new Date("2026-09-01T00:00:00Z"),
    };
    const legacy = generateRepaymentSchedule(terms);
    const next = generateRepaymentSchedule({ ...terms, interestDayCount: INTEREST_DAY_COUNT.FOUR_WEEK_MONTH });
    expect(legacy.reduce((sum, item) => sum + item.interestDueMinor, 0n)).toBe(15_465_205n);
    expect(next.reduce((sum, item) => sum + item.interestDueMinor, 0n)).toBe(16_800_000n);
    expect(next.every((item) => item.interestDueMinor === 700_000n)).toBe(true);
    expect(next[0].dueOn.toISOString().slice(0, 10)).toBe("2026-09-08");
    expect(next[1].dueOn.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("creates declining-balance interest that falls with the balance", () => {
    const schedule = generateRepaymentSchedule({ principalMinor: 300_000_000n, annualRateBps: 3360, repaymentCount: 12, repaymentFrequency: "1 Months", interestMethod: "Declining Balance", disbursedOn: new Date("2026-01-31T00:00:00Z") });
    expect(schedule.reduce((sum, item) => sum + item.principalDueMinor, 0n)).toBe(300_000_000n);
    expect(schedule[0].interestDueMinor).toBeGreaterThan(schedule[11].interestDueMinor);
    expect(schedule.every((item) => item.feesDueMinor === 0n)).toBe(true);
    expect(schedule[0].dueOn.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("adds flat monitoring fees without changing principal or interest math", () => {
    const schedule = generateRepaymentSchedule({ principalMinor: 120_000n, annualRateBps: 1200, monitoringFeeAnnualRateBps: 600, repaymentCount: 12, repaymentFrequency: "1 Months", interestMethod: "Flat", disbursedOn: new Date("2026-01-01T00:00:00Z") });
    expect(schedule.every((item) => item.monitoringFeeDueMinor === 600n)).toBe(true);
    expect(schedule.reduce((sum, item) => sum + item.monitoringFeeDueMinor, 0n)).toBe(7_200n);
    expect(schedule.reduce((sum, item) => sum + item.principalDueMinor, 0n)).toBe(120_000n);
    // Monitoring fee is tracked in its own dedicated column, never merged back into feesDueMinor.
    expect(schedule.every((item) => item.feesDueMinor === 0n)).toBe(true);
  });

  it("adds declining-balance monitoring fees from the outstanding balance", () => {
    const schedule = generateRepaymentSchedule({ principalMinor: 100_000n, annualRateBps: 0, monitoringFeeAnnualRateBps: 1200, repaymentCount: 4, repaymentFrequency: "1 Months", interestMethod: "Declining Balance", disbursedOn: new Date("2026-01-01T00:00:00Z") });
    expect(schedule.map((item) => item.monitoringFeeDueMinor)).toEqual([1_000n, 750n, 500n, 250n]);
    expect(schedule.reduce((sum, item) => sum + item.principalDueMinor, 0n)).toBe(100_000n);
    expect(schedule.every((item) => item.interestDueMinor === 0n)).toBe(true);
    expect(schedule.every((item) => item.feesDueMinor === 0n)).toBe(true);
  });

  it("rejects unsupported frequencies", () => {
    expect(() => parseRepaymentFrequency("yearly")).toThrow("Unsupported repayment frequency");
  });

  it("accepts weekly, monthly, and daily as every-one-period aliases", () => {
    expect(parseRepaymentFrequency("weekly")).toEqual({ every: 1, unit: "WEEKS" });
    expect(parseRepaymentFrequency("WEEKLY")).toEqual({ every: 1, unit: "WEEKS" });
    expect(parseRepaymentFrequency("every week")).toEqual({ every: 1, unit: "WEEKS" });
    expect(parseRepaymentFrequency("monthly")).toEqual({ every: 1, unit: "MONTHS" });
    expect(parseRepaymentFrequency("daily")).toEqual({ every: 1, unit: "DAYS" });
  });

  it("describes weekly collections as every 7 days", () => {
    expect(describeRepaymentCadence(parseRepaymentFrequency("1 Weeks"))).toBe("every 7 days");
    expect(describeRepaymentCadence(parseRepaymentFrequency("1 Months"))).toBe("monthly");
  });

  it("treats missing day-count as Actual/365 so pending loans keep old math", () => {
    expect(readInterestDayCount(undefined)).toBe(INTEREST_DAY_COUNT.ACTUAL_365);
    expect(readInterestDayCount("FOUR_WEEK_MONTH")).toBe(INTEREST_DAY_COUNT.FOUR_WEEK_MONTH);
  });

  it("charges 2.2% interest and 2.8% monitoring per month on a 24-week personal loan", () => {
    const schedule = generateRepaymentSchedule({
      principalMinor: 70_000_000n,
      annualRateBps: 2_640,
      monitoringFeeAnnualRateBps: 3_360,
      repaymentCount: 24,
      repaymentFrequency: "1 Weeks",
      interestMethod: "Flat",
      interestDayCount: INTEREST_DAY_COUNT.FOUR_WEEK_MONTH,
      disbursedOn: new Date("2026-09-18T00:00:00Z"),
    });
    expect(schedule.reduce((sum, item) => sum + item.principalDueMinor, 0n)).toBe(70_000_000n);
    expect(schedule.reduce((sum, item) => sum + item.interestDueMinor, 0n)).toBe(9_240_000n);
    expect(schedule.reduce((sum, item) => sum + item.monitoringFeeDueMinor, 0n)).toBe(11_760_000n);
  });
});
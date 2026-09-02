import { describe, expect, it } from "vitest";

import { generateRepaymentSchedule, parseRepaymentFrequency } from "./repayment-schedule";

describe("repayment schedule", () => {
  it("preserves every principal minor unit for flat weekly loans", () => {
    const schedule = generateRepaymentSchedule({ principalMinor: 70_000_000n, annualRateBps: 3360, repaymentCount: 20, repaymentFrequency: "1 Weeks", interestMethod: "Flat", disbursedOn: new Date("2026-09-02T00:00:00Z") });
    expect(schedule).toHaveLength(20);
    expect(schedule.reduce((sum, item) => sum + item.principalDueMinor, 0n)).toBe(70_000_000n);
    expect(schedule[0].dueOn.toISOString().slice(0, 10)).toBe("2026-09-09");
    expect(schedule[19].dueOn.toISOString().slice(0, 10)).toBe("2027-01-20");
  });

  it("creates declining-balance interest that falls with the balance", () => {
    const schedule = generateRepaymentSchedule({ principalMinor: 300_000_000n, annualRateBps: 3360, repaymentCount: 12, repaymentFrequency: "1 Months", interestMethod: "Declining Balance", disbursedOn: new Date("2026-01-31T00:00:00Z") });
    expect(schedule.reduce((sum, item) => sum + item.principalDueMinor, 0n)).toBe(300_000_000n);
    expect(schedule[0].interestDueMinor).toBeGreaterThan(schedule[11].interestDueMinor);
    expect(schedule[0].dueOn.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("rejects unsupported frequencies", () => {
    expect(() => parseRepaymentFrequency("fortnightly")).toThrow("Unsupported repayment frequency");
  });
});
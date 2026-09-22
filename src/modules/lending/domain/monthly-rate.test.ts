import { describe, expect, it } from "vitest";

import { annualBpsFromMonthlyPercent, formatMonthlyPercent, monthlyPercentFromAnnualBps } from "./monthly-rate";

describe("monthly loan rates", () => {
  it("stores 2.2% and 2.8% per month as annual basis points", () => {
    expect(annualBpsFromMonthlyPercent(2.2)).toBe(2_640);
    expect(annualBpsFromMonthlyPercent(2.8)).toBe(3_360);
    expect(monthlyPercentFromAnnualBps(2_640)).toBe(2.2);
    expect(monthlyPercentFromAnnualBps(3_360)).toBe(2.8);
    expect(formatMonthlyPercent(2_640)).toBe("2.2");
    expect(formatMonthlyPercent(3_360)).toBe("2.8");
  });
});

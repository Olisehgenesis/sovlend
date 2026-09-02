import { describe, expect, it } from "vitest";

import { calculateLoanPayoff, type PayoffInstallment } from "./loan-payoff";

const past: PayoffInstallment = { id: "one", dueOn: new Date("2026-08-01"), installmentNumber: 1, principalDueMinor: 10_000n, interestDueMinor: 1_000n, feesDueMinor: 200n, penaltiesDueMinor: 100n, principalPaidMinor: 0n, interestPaidMinor: 0n, feesPaidMinor: 0n, penaltiesPaidMinor: 0n };
const future: PayoffInstallment = { id: "two", dueOn: new Date("2026-12-01"), installmentNumber: 2, principalDueMinor: 10_000n, interestDueMinor: 1_500n, feesDueMinor: 0n, penaltiesDueMinor: 0n, principalPaidMinor: 0n, interestPaidMinor: 0n, feesPaidMinor: 0n, penaltiesPaidMinor: 0n };

describe("calculateLoanPayoff", () => {
  it("collects all remaining principal but only interest accrued to date", () => {
    const quote = calculateLoanPayoff([past, future], { asOfDate: new Date("2026-09-02") });
    expect(quote.principalOutstandingMinor).toBe(20_000n);
    expect(quote.interestAccruedMinor).toBe(1_000n);
    expect(quote.interestWaivedMinor).toBe(1_500n);
    expect(quote.feesOutstandingMinor).toBe(200n);
    expect(quote.penaltiesCollectedMinor).toBe(100n);
    expect(quote.penaltiesWaivedMinor).toBe(0n);
    expect(quote.totalPayoffMinor).toBe(21_300n);
  });

  it("waives penalties when requested (foreclosure policy)", () => {
    const quote = calculateLoanPayoff([past, future], { asOfDate: new Date("2026-09-02"), waivePenalties: true });
    expect(quote.penaltiesCollectedMinor).toBe(0n);
    expect(quote.penaltiesWaivedMinor).toBe(100n);
    expect(quote.totalPayoffMinor).toBe(21_200n);
  });

  it("accounts for prior partial payments on an installment", () => {
    const partial = { ...past, principalPaidMinor: 4_000n, interestPaidMinor: 500n, feesPaidMinor: 200n, penaltiesPaidMinor: 100n };
    const quote = calculateLoanPayoff([partial], { asOfDate: new Date("2026-09-02") });
    expect(quote.principalOutstandingMinor).toBe(6_000n);
    expect(quote.interestAccruedMinor).toBe(500n);
    expect(quote.feesOutstandingMinor).toBe(0n);
    expect(quote.penaltiesCollectedMinor).toBe(0n);
    expect(quote.totalPayoffMinor).toBe(6_500n);
  });

  it("skips fully settled installments", () => {
    const settled = { ...past, principalPaidMinor: 10_000n, interestPaidMinor: 1_000n, feesPaidMinor: 200n, penaltiesPaidMinor: 100n };
    const quote = calculateLoanPayoff([settled], { asOfDate: new Date("2026-09-02") });
    expect(quote.totalPayoffMinor).toBe(0n);
    expect(quote.settlements).toHaveLength(0);
  });
});

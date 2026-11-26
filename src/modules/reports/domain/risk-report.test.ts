import { describe, expect, it } from "vitest";

import { daysInArrearsBand, parTotals, provisioningPrincipalMinor, weeksInArrearsBand } from "./risk-report";

const loan = (overrides: Partial<Parameters<typeof parTotals>[0][number]> = {}) => ({
  outstandingPrincipalMinor: 1_000_000n,
  principalWrittenOffMinor: 0n,
  overduePrincipalMinor: 0n,
  ...overrides,
});

describe("parTotals", () => {
  it("counts only overdue principal, not the whole balance of a delinquent loan", () => {
    // Half of this loan is still not due, so only the overdue half belongs in PAR.
    const result = parTotals([loan({ outstandingPrincipalMinor: 1_000_000n, overduePrincipalMinor: 400_000n })]);
    expect(result.totalOutstandingPrincipalMinor).toBe(1_000_000n);
    expect(result.overdueOutstandingPrincipalMinor).toBe(400_000n);
    expect(result.parBps).toBe(4_000);
  });

  it("nets written-off principal out of the denominator, like the dashboard", () => {
    // Dashboard SQL: GREATEST(total due - paid - waived - writtenOff, 0) per loan.
    const result = parTotals([
      loan({ outstandingPrincipalMinor: 1_000_000n, principalWrittenOffMinor: 400_000n, overduePrincipalMinor: 300_000n }),
    ]);
    expect(result.totalOutstandingPrincipalMinor).toBe(600_000n);
    expect(result.parBps).toBe(5_000);
  });

  it("keeps the provision inside outstanding principal", () => {
    expect(
      provisioningPrincipalMinor({ outstandingPrincipalMinor: 5_000_000n, principalWrittenOffMinor: 1_000_000n }),
    ).toBe(4_000_000n);
    expect(provisioningPrincipalMinor({ outstandingPrincipalMinor: 100n, principalWrittenOffMinor: 500n })).toBe(0n);
  });

  it("matches the aging sheet week and day bands", () => {
    expect(weeksInArrearsBand(3)).toBe("<1");
    expect(weeksInArrearsBand(38)).toBe("6");
    expect(weeksInArrearsBand(82)).toBe("12");
    expect(weeksInArrearsBand(125)).toBe("12+");
    expect(daysInArrearsBand(3)).toBe("0 - 30");
    expect(daysInArrearsBand(38)).toBe("30 - 60");
    expect(daysInArrearsBand(82)).toBe("60 - 90");
    expect(daysInArrearsBand(125)).toBe("90 - 180");
    expect(daysInArrearsBand(237)).toBe("180 - 360");
    expect(daysInArrearsBand(422)).toBe("> 360");
  });

  it("never returns a negative denominator when the write-off exceeds the balance", () => {
    const result = parTotals([loan({ outstandingPrincipalMinor: 200_000n, principalWrittenOffMinor: 300_000n, overduePrincipalMinor: 50_000n })]);
    expect(result.totalOutstandingPrincipalMinor).toBe(0n);
    expect(result.parBps).toBe(0);
  });
});

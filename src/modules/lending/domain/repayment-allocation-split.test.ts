import { describe, expect, it } from "vitest";

import { repaymentRecordedMessage, repaymentSplitFromAllocations } from "./repayment-allocation-split";

describe("repaymentSplitFromAllocations", () => {
  it("sums principal, interest, and maintenance across installments", () => {
    expect(
      repaymentSplitFromAllocations([
        { principalMinor: 10_000n, interestMinor: 2_000n, feesMinor: 0n, monitoringFeeMinor: 500n, penaltiesMinor: 0n },
        { principalMinor: 5_000n, interestMinor: 1_000n, feesMinor: 200n, monitoringFeeMinor: 0n, penaltiesMinor: 100n },
      ]),
    ).toEqual({
      principalMinor: 15_000n,
      interestMinor: 3_000n,
      feesMinor: 200n,
      monitoringFeeMinor: 500n,
      penaltiesMinor: 100n,
    });
  });
});

describe("repaymentRecordedMessage", () => {
  it("names principal and interest so the split is visible after posting", () => {
    expect(
      repaymentRecordedMessage({
        principalMinor: "1000000",
        interestMinor: "200000",
        monitoringFeeMinor: "50000",
      }),
    ).toBe("Repayment recorded · Principal UGX 10,000 · Interest UGX 2,000 · Maintenance UGX 500");
  });
});

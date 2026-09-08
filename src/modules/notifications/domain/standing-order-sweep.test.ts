import { describe, expect, it } from "vitest";

import { computeSweepAmountMinor, standingOrderSweepJobId, standingOrderSweepJobSchema } from "./standing-order-sweep";

describe("standing order sweep jobs", () => {
  it("keys deduplication by loan id and due date, ignoring the time portion", () => {
    const data = standingOrderSweepJobSchema.parse({
      loanId: "10c37978-c861-4aac-9d4a-5ff72c9a660a",
      installmentId: "d8359aa2-57f4-4e6b-8070-973695c18fad",
      clientId: "3c6dad45-3665-49f4-bc4e-d5f33c830bae",
      savingsAccountId: "9b6b7e2b-3d0a-4b8f-8f0a-6f4a2f7b1c11",
      accountNumber: "SL-001042",
      dueOn: "2026-09-01T00:00:00.000Z",
      outstandingMinor: "408308",
      currencyCode: "UGX",
      mobileNumber: "0700000000",
    });

    expect(standingOrderSweepJobId(data)).toBe(
      "standing-order-sweep:10c37978-c861-4aac-9d4a-5ff72c9a660a:2026-09-01",
    );
  });

  describe("computeSweepAmountMinor", () => {
    it("sweeps the smaller of available balance and outstanding amount", () => {
      expect(computeSweepAmountMinor(50_000n, 30_000n)).toBe(30_000n);
      expect(computeSweepAmountMinor(10_000n, 30_000n)).toBe(10_000n);
    });

    it("never sweeps a non-positive amount", () => {
      expect(computeSweepAmountMinor(0n, 30_000n)).toBe(0n);
      expect(computeSweepAmountMinor(-5_000n, 30_000n)).toBe(0n);
      expect(computeSweepAmountMinor(50_000n, 0n)).toBe(0n);
    });
  });
});

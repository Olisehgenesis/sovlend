import { describe, expect, it } from "vitest";

import { satsToUgxMinor } from "./valuation";

describe("satsToUgxMinor", () => {
  it("converts a sats balance to UGX minor units using a combined BTC/UGX rate", () => {
    // 0.001 BTC at 250,000,000 UGX/BTC = 250,000 UGX = 25,000,000 minor units.
    expect(satsToUgxMinor(100_000n, 250_000_000)).toBe(25_000_000n);
  });

  it("returns null when no fresh price is available rather than fabricating a rate", () => {
    expect(satsToUgxMinor(100_000n, null)).toBeNull();
  });

  it("returns zero for a zero balance", () => {
    expect(satsToUgxMinor(0n, 250_000_000)).toBe(0n);
  });
});

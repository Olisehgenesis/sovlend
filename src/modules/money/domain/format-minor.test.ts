import { describe, expect, it } from "vitest";

import { formatMinor } from "./format-minor";

describe("formatMinor", () => {
  it("formats migrated UGX cents as whole shillings, rounded, no decimals", () => {
    expect(formatMinor(20_000_000n, "UGX")).toBe("UGX 200,000");
  });

  it("rounds UGX to the nearest shilling instead of truncating", () => {
    expect(formatMinor(20_000_051n, "UGX")).toBe("UGX 200,001");
    expect(formatMinor(20_000_049n, "UGX")).toBe("UGX 200,000");
  });

  it("keeps USD at 2 decimal places", () => {
    expect(formatMinor(150_25n, "USD")).toBe("USD 150.25");
  });

  it("preserves BTC satoshi precision", () => {
    expect(formatMinor(426_666n, "BTC")).toBe("0.00426666 BTC");
  });
});
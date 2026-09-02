import { describe, expect, it } from "vitest";

import { formatMinor } from "./format-minor";

describe("formatMinor", () => {
  it("formats migrated UGX cents as shillings", () => {
    expect(formatMinor(20_000_000n, "UGX")).toBe("UGX 200,000.00");
  });

  it("preserves BTC satoshi precision", () => {
    expect(formatMinor(426_666n, "BTC")).toBe("0.00426666 BTC");
  });
});
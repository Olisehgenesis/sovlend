import { describe, expect, it } from "vitest";
import { processingFeeBps, processingFeePercentSchema } from "./processing-fee";
describe("processing fee rate", () => {
  it("uses the loan snapshot before the product default, preserving zero", () => {
    expect(processingFeeBps({ processingFeeBps: 600 }, 500)).toBe(600);
    expect(processingFeeBps({ processingFeeBps: 0 }, 500)).toBe(0);
    expect(processingFeeBps(null, 500)).toBe(500);
    expect(processingFeeBps({})).toBe(200);
    expect(() => processingFeeBps({ processingFeeBps: "bad" }, 500)).toThrow();
  });
  it("accepts at most two decimal places and valid percentages", () => {
    expect(processingFeePercentSchema.parse("5.25")).toBe(5.25);
    for (const value of ["6.123", -1, 101, NaN]) expect(processingFeePercentSchema.safeParse(value).success).toBe(false);
  });
});

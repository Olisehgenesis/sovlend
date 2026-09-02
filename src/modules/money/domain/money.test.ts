import { describe, expect, it } from "vitest";

import { addMoney, convertMoney, formatMoney, money } from "./money";

const UGX = { code: "UGX", exponent: 0 } as const;
const BTC = { code: "BTC", exponent: 8 } as const;

describe("money", () => {
  it("adds exact minor units", () => {
    expect(addMoney(money(400_000n, UGX), money(600_000n, UGX)).amountMinor).toBe(1_000_000n);
  });

  it("rejects mixed currencies", () => {
    expect(() => addMoney(money(1n, UGX), money(1n, BTC))).toThrow("Currency mismatch");
  });

  it("formats satoshis without floating point", () => {
    expect(formatMoney(money(426_667n, BTC))).toBe("0.00426667");
  });

  it("converts source units to target minor units with half-up rounding", () => {
    expect(convertMoney(money(100_000_000n, BTC), UGX, "234375000").amountMinor).toBe(234_375_000n);
  });
});
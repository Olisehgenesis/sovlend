import { describe, expect, it } from "vitest";

import { nextSubAccountNumber } from "./sub-account-numbering";

describe("nextSubAccountNumber", () => {
  it("gives a group member's four savings accounts four different numbers", () => {
    const numbers = [0, 1, 2, 3].map((index) => nextSubAccountNumber("000000999", "S", index));
    expect(numbers).toEqual(["000000999S", "000000999S2", "000000999S3", "000000999S4"]);
    expect(new Set(numbers).size).toBe(4);
  });

  it("keeps the bare suffix for the first account and numbers the rest", () => {
    expect(nextSubAccountNumber("000000999", "L", 0)).toBe("000000999L");
    expect(nextSubAccountNumber("000000999", "L", 1)).toBe("000000999L2");
  });
});

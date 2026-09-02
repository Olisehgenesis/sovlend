import { describe, expect, it } from "vitest";

import { contributionToSats } from "./conversion";

describe("contributionToSats", () => {
  it("converts UGX through audited USD rates", () => {
    expect(contributionToSats({ amountMinor: 1_000_000n, currencyCode: "UGX", btcUsd: "62500", usdUgx: "3750" })).toBe(426_666n);
  });

  it("converts USD cents directly", () => {
    expect(contributionToSats({ amountMinor: 10_000n, currencyCode: "USD", btcUsd: "50000" })).toBe(200_000n);
  });
});
import { describe, expect, it } from "vitest";

import { assertBalancedJournal } from "./journal";

describe("assertBalancedJournal", () => {
  it("accepts balanced lines per currency", () => {
    expect(() =>
      assertBalancedJournal([
        { accountId: "cash", currencyCode: "UGX", direction: "DEBIT", amountMinor: 1_000_000n },
        { accountId: "loan", currencyCode: "UGX", direction: "CREDIT", amountMinor: 1_000_000n },
      ]),
    ).not.toThrow();
  });

  it("rejects cross-currency balancing", () => {
    expect(() =>
      assertBalancedJournal([
        { accountId: "btc", currencyCode: "BTC", direction: "DEBIT", amountMinor: 10_000n },
        { accountId: "cash", currencyCode: "UGX", direction: "CREDIT", amountMinor: 10_000n },
      ]),
    ).toThrow("BTC");
  });
});
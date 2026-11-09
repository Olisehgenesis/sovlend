import { describe, expect, it } from "vitest";

import { assertBalancedJournal, journalLineDescription } from "./journal";

describe("journalLineDescription", () => {
  it("prefers narration over memo so account-name memos do not hide the user text", () => {
    expect(journalLineDescription("Office rent for September", "Cash")).toBe("Office rent for September");
  });

  it("falls back to memo when narration is empty", () => {
    expect(journalLineDescription("  ", "Waive monitoring fee")).toBe("Waive monitoring fee");
    expect(journalLineDescription(null, "Deposit")).toBe("Deposit");
  });
});

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
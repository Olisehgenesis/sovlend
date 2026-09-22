import { describe, expect, it } from "vitest";

import { displaySavingsProductName, storedSavingsProductNamesMatching } from "./savings-product-label";

describe("displaySavingsProductName", () => {
  it("renames LIF, compulsory, and member savings for the interface only", () => {
    expect(displaySavingsProductName("LIF Account Savings")).toBe("Loan insurance fund");
    expect(displaySavingsProductName("Compulsory savings")).toBe("Loan security payable");
    expect(displaySavingsProductName("Member Savings Account")).toBe("Member contribution");
  });

  it("leaves other product names unchanged", () => {
    expect(displaySavingsProductName("Group general savings")).toBe("Group general savings");
    expect(displaySavingsProductName("Security Fee Payable")).toBe("Security Fee Payable");
  });
});

describe("storedSavingsProductNamesMatching", () => {
  it("lets operators search by the on-screen name", () => {
    expect(storedSavingsProductNamesMatching("loan insurance")).toEqual(["LIF Account Savings"]);
    expect(storedSavingsProductNamesMatching("security payable")).toEqual(["Compulsory savings"]);
    expect(storedSavingsProductNamesMatching("member contribution")).toEqual(["Member Savings Account"]);
  });
});

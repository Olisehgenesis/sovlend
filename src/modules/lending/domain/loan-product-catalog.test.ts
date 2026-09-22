import { describe, expect, it } from "vitest";

import { formatLoanProductTerm, groupLoanProductsByTerm, loanProductMatchesQuery } from "./loan-product-catalog";

describe("groupLoanProductsByTerm", () => {
  it("groups by repayment cycle and sorts weekly products by term length, not alphabetically", () => {
    const groups = groupLoanProductsByTerm([
      { name: "12 weeks Loans", repaymentCount: 12, repaymentFrequency: "1 Weeks" },
      { name: "40 WEEK LOAN", repaymentCount: 40, repaymentFrequency: "1 Weeks" },
      { name: "4 Weeks Loan", repaymentCount: 4, repaymentFrequency: "1 Weeks" },
      { name: "GROUP LOAN PRODUCT", repaymentCount: 12, repaymentFrequency: "1 Months" },
      { name: "micro-loan daily repayment product", repaymentCount: 1, repaymentFrequency: "1 Days" },
      { name: "8 week Loan", repaymentCount: 8, repaymentFrequency: "1 Weeks" },
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Daily", "Weekly", "Monthly"]);
    expect(groups[1].products.map((product) => product.name)).toEqual([
      "4 Weeks Loan",
      "8 week Loan",
      "12 weeks Loans",
      "40 WEEK LOAN",
    ]);
  });

  it("keeps inactive products at the end of a group", () => {
    const groups = groupLoanProductsByTerm([
      { name: "Active 12 week", repaymentCount: 12, repaymentFrequency: "1 Weeks", active: true },
      { name: "Retired 4 week", repaymentCount: 4, repaymentFrequency: "1 Weeks", active: false },
      { name: "Active 8 week", repaymentCount: 8, repaymentFrequency: "1 Weeks" },
    ]);

    expect(groups[0].products.map((product) => product.name)).toEqual([
      "Active 8 week",
      "Active 12 week",
      "Retired 4 week",
    ]);
  });
});

describe("loanProductMatchesQuery", () => {
  const product = {
    name: "4 Weeks Loan",
    shortName: "4WL",
    repaymentCount: 4,
    repaymentFrequency: "1 Weeks",
  };

  it("matches name, code, and term labels", () => {
    expect(loanProductMatchesQuery(product, "4wl")).toBe(true);
    expect(loanProductMatchesQuery(product, "weekly")).toBe(true);
    expect(loanProductMatchesQuery(product, "4 weekly")).toBe(true);
    expect(loanProductMatchesQuery(product, "monthly")).toBe(false);
  });
});

describe("formatLoanProductTerm", () => {
  it("describes common frequencies without the raw 'count | 1 Weeks' markup", () => {
    expect(formatLoanProductTerm(4, "1 Weeks")).toBe("4 weekly");
    expect(formatLoanProductTerm(12, "1 Months")).toBe("12 monthly");
    expect(formatLoanProductTerm(1, "1 Days")).toBe("1 daily");
    expect(formatLoanProductTerm(6, "2 Weeks")).toBe("6 × every 2 weeks");
  });
});

import { describe, expect, it } from "vitest";

import { isInvestorApproverRole } from "./can-manage-investor-access";

describe("isInvestorApproverRole", () => {
  it("lets branch managers, general managers, and admins approve investors", () => {
    expect(isInvestorApproverRole("BRANCH_MANAGER")).toBe(true);
    expect(isInvestorApproverRole("GENERAL_MANAGER")).toBe(true);
    expect(isInvestorApproverRole("ADMIN")).toBe(true);
  });

  it("does not let tellers or loan officers approve investors", () => {
    expect(isInvestorApproverRole("TELLER")).toBe(false);
    expect(isInvestorApproverRole("LOAN_OFFICER")).toBe(false);
    expect(isInvestorApproverRole("INVESTOR")).toBe(false);
    expect(isInvestorApproverRole(null)).toBe(false);
  });
});

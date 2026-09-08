import { describe, expect, it } from "vitest";

import { canEditSubmittedLoanApplication, canSelfApproveLoanApplication } from "./loan-application-access";

describe("loan application edit access", () => {
  it("lets the submitter fix a pending application", () => {
    expect(canEditSubmittedLoanApplication({ actorUserId: "maker-1", actorSystemRole: "LOAN_OFFICER", submittedById: "maker-1" })).toBe(true);
  });

  it("lets approving managers edit another user's submission", () => {
    expect(canEditSubmittedLoanApplication({ actorUserId: "manager-1", actorSystemRole: "BRANCH_MANAGER", submittedById: "maker-1" })).toBe(true);
    expect(canSelfApproveLoanApplication("GENERAL_MANAGER")).toBe(true);
    expect(canSelfApproveLoanApplication("ADMIN")).toBe(true);
  });

  it("keeps non-approvers from editing another user's submission", () => {
    expect(canEditSubmittedLoanApplication({ actorUserId: "officer-2", actorSystemRole: "LOAN_OFFICER", submittedById: "maker-1" })).toBe(false);
    expect(canSelfApproveLoanApplication("LOAN_OFFICER")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { hasPermission, permissions, type PermissionAssignment } from "./permissions";

const assignment: PermissionAssignment = {
  permissionCodes: [permissions.loanApprove],
  organizationId: "org-1",
  scope: "OFFICE",
  officeId: "branch-1",
  includeChildOffices: true,
  approvalLimitMinor: 5_000_000n,
  approvalCurrencyCode: "UGX",
  validFrom: new Date("2026-01-01"),
  validUntil: null,
};

describe("branch permissions", () => {
  it("allows child-branch approval within the assigned limit", () => {
    expect(hasPermission([assignment], { permission: permissions.loanApprove, organizationId: "org-1", officeId: "sub-branch", officeAncestorIds: ["branch-1"], actorUserId: "manager", amountMinor: 4_000_000n, currencyCode: "UGX", now: new Date("2026-09-01") })).toBe(true);
  });

  it("rejects approvals above the manager limit", () => {
    expect(hasPermission([assignment], { permission: permissions.loanApprove, organizationId: "org-1", officeId: "branch-1", actorUserId: "manager", amountMinor: 6_000_000n, currencyCode: "UGX", now: new Date("2026-09-01") })).toBe(false);
  });

  it("rejects another organization", () => {
    expect(hasPermission([assignment], { permission: permissions.loanApprove, organizationId: "org-2", officeId: "branch-1", actorUserId: "manager", amountMinor: 1_000_000n, currencyCode: "UGX", now: new Date("2026-09-01") })).toBe(false);
  });
});
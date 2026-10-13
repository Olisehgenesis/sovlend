import type { PrismaClient, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const allowed = vi.hoisted(() => vi.fn(async () => false));
vi.mock("@/modules/identity/application/authorization-service", () => ({ AuthorizationService: class { isAllowed = allowed; } }));
import { canReturnLoanToDraft } from "./return-loan-to-draft-access";
const scope = { organizationId: "org", officeIds: ["office"], officerUserId: null };
const context = { actorUserId: "manager", officeId: "office", principalMinor: 300000000n, currencyCode: "UGX" };
function mock(systemRole: UserRole) {
  const actor = { systemRole, organizationId: "org", banned: false };
  const user = { findUnique: vi.fn(async () => actor) };
  return { actor, user, db: { user } as unknown as PrismaClient };
}
describe("return to draft access", () => {
  beforeEach(() => { allowed.mockReset(); allowed.mockResolvedValue(false); });
  it.each(["BRANCH_MANAGER", "GENERAL_MANAGER", "ADMIN"] as const)("allows %s without approval permission or amount limits", async role => {
    const { db } = mock(role);
    expect(await canReturnLoanToDraft(db, scope, context)).toBe(true);
    expect(allowed).not.toHaveBeenCalled();
  });
  it.each(["TELLER", "LOAN_OFFICER", "AUDITOR"] as const)("still requires scoped approval permission for %s", async role => {
    const { db } = mock(role);
    expect(await canReturnLoanToDraft(db, scope, context)).toBe(false);
    expect(allowed).toHaveBeenCalledWith({
      actorUserId: "manager", permission: "LOAN_APPROVE", organizationId: "org",
      officeId: "office", amountMinor: 300000000n, currencyCode: "UGX",
    });
    allowed.mockResolvedValue(true);
    expect(await canReturnLoanToDraft(db, scope, context)).toBe(true);
  });
  it("does not broaden manager office scope, including an empty scope", async () => {
    const { db, user } = mock("BRANCH_MANAGER");
    expect(await canReturnLoanToDraft(db, scope, { ...context, officeId: "other-office" })).toBe(false);
    expect(await canReturnLoanToDraft(db, { ...scope, officeIds: [] }, context)).toBe(false);
    expect(user.findUnique).not.toHaveBeenCalled();
  });
  it("rejects another organization's manager and banned accounts", async () => {
    const { db, actor } = mock("GENERAL_MANAGER");
    actor.organizationId = "another-org";
    expect(await canReturnLoanToDraft(db, scope, context)).toBe(false);
    actor.organizationId = "org"; actor.banned = true;
    expect(await canReturnLoanToDraft(db, scope, context)).toBe(false);
    expect(allowed).not.toHaveBeenCalled();
  });
});

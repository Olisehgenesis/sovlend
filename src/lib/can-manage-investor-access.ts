import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

export function isInvestorApproverRole(systemRole: string | null | undefined) {
  return systemRole === "ADMIN" || systemRole === "GENERAL_MANAGER" || systemRole === "BRANCH_MANAGER";
}

/**
 * Platform super-admins can approve investor access requests for any business. Branch managers
 * and general managers can approve for their own organization, matching loan self-approval.
 * Anyone else needs the INVESTOR_ACCESS_MANAGE permission on their assigned group.
 */
export async function canManageInvestorAccessForOrganization(session: { user: { id: string; role?: string | null } }, organizationId: string): Promise<boolean> {
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true, systemRole: true } });
  if (!user?.organizationId || user.organizationId !== organizationId) return false;
  if (isInvestorApproverRole(user.systemRole)) return true;
  return new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, organizationId, permissions.investorAccessManage);
}

/** Returns the organization a non-super-admin can manage investor access for, or `null` if the
 * user is a super-admin (who can see every organization's requests) or is not authorized at all. */
export async function loadInvestorAccessScope(session: { user: { id: string; role?: string | null } }): Promise<{ isSuperAdmin: true; organizationId: null } | { isSuperAdmin: false; organizationId: string } | null> {
  if (session.user.role === "admin") return { isSuperAdmin: true, organizationId: null };
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true, systemRole: true } });
  if (!user?.organizationId) return null;
  if (isInvestorApproverRole(user.systemRole)) return { isSuperAdmin: false, organizationId: user.organizationId };
  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, user.organizationId, permissions.investorAccessManage);
  if (!allowed) return null;
  return { isSuperAdmin: false, organizationId: user.organizationId };
}

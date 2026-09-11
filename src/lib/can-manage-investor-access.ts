import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

/**
 * Platform super-admins can approve investor access requests for any business. Otherwise a
 * user needs the INVESTOR_ACCESS_MANAGE permission within their own organization (granted by
 * default to the Branch Manager and General Manager permission groups -- see
 * defaultPermissionGroups in modules/identity/domain/permissions.ts), and can only approve
 * requests for that one organization.
 */
export async function canManageInvestorAccessForOrganization(session: { user: { id: string; role?: string | null } }, organizationId: string): Promise<boolean> {
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId || user.organizationId !== organizationId) return false;
  return new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, organizationId, permissions.investorAccessManage);
}

/** Returns the organization a non-super-admin can manage investor access for, or `null` if the
 * user is a super-admin (who can see every organization's requests) or is not authorized at all. */
export async function loadInvestorAccessScope(session: { user: { id: string; role?: string | null } }): Promise<{ isSuperAdmin: true; organizationId: null } | { isSuperAdmin: false; organizationId: string } | null> {
  if (session.user.role === "admin") return { isSuperAdmin: true, organizationId: null };
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) return null;
  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, user.organizationId, permissions.investorAccessManage);
  if (!allowed) return null;
  return { isSuperAdmin: false, organizationId: user.organizationId };
}

import { prisma } from "@/lib/prisma";
import { loadAccessUser } from "@/modules/identity/application/actor-access";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

// Platform super-admins always pass; otherwise a user needs the PRODUCT_MANAGE
// permission within their own organization (e.g. General/Branch Manager groups).
export async function canManageProducts(session: { user: { id: string; role?: string | null } }): Promise<{ allowed: boolean; organizationId: string | null }> {
  const user = await loadAccessUser(session.user.id);
  if (session.user.role === "admin") {
    return { allowed: true, organizationId: user?.organizationId ?? null };
  }
  if (!user?.organizationId) return { allowed: false, organizationId: null };
  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, user.organizationId, permissions.productManage);
  return { allowed, organizationId: user.organizationId };
}

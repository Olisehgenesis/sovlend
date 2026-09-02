import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

// Platform super-admins always pass; otherwise a user needs the PRODUCT_MANAGE
// permission within their own organization (e.g. General/Branch Manager groups).
export async function canManageProducts(session: { user: { id: string; role?: string | null } }): Promise<{ allowed: boolean; organizationId: string | null }> {
  if (session.user.role === "admin") {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
    return { allowed: true, organizationId: user?.organizationId ?? null };
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) return { allowed: false, organizationId: null };
  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, user.organizationId, permissions.productManage);
  return { allowed, organizationId: user.organizationId };
}

import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

// Platform super-admins always pass; otherwise a user needs the LEDGER_POST permission within
// their own organization (e.g. General/Branch Manager groups) to see and use the manual
// income/expense recording links in the Accounting nav.
export async function canPostLedger(session: { user: { id: string; role?: string | null } }): Promise<boolean> {
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) return false;
  return new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, user.organizationId, permissions.ledgerPost);
}

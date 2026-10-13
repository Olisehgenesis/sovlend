import type { PrismaClient } from "@prisma/client";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import type { UserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { canSelfApproveLoanApplication } from "./loan-application-access";

export async function canReturnLoanToDraft(db: PrismaClient, scope: UserDataScope, context: {
  actorUserId: string; officeId: string; principalMinor: bigint; currencyCode: string;
}) {
  if (scope.officeIds && !scope.officeIds.includes(context.officeId)) return false;
  const actor = await db.user.findUnique({
    where: { id: context.actorUserId },
    select: { systemRole: true, organizationId: true, banned: true },
  });
  if (!actor || actor.banned || actor.organizationId !== scope.organizationId) return false;
  if (canSelfApproveLoanApplication(actor.systemRole)) return true;
  return new AuthorizationService(db).isAllowed({
    actorUserId: context.actorUserId, permission: permissions.loanApprove,
    organizationId: scope.organizationId, officeId: context.officeId,
    amountMinor: context.principalMinor, currencyCode: context.currencyCode,
  });
}

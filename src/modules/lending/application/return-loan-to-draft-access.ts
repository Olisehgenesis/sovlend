import type { PrismaClient, UserRole } from "@prisma/client";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import type { UserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { STAFF_SYSTEM_ROLES } from "@/modules/identity/domain/staff-roles";
import { canSelfApproveLoanApplication } from "./loan-application-access";

const automaticReturnToReviewNames = new Set(["robinah", "oliseh"]);

/** Robinah and Oliseh can send an approved, undisbursed loan back to review without a separate grant. */
export function isAutomaticReturnToReviewUser(user: { name: string; systemRole: UserRole }) {
  const firstName = user.name.trim().toLowerCase().split(/\s+/)[0];
  return STAFF_SYSTEM_ROLES.includes(user.systemRole) && automaticReturnToReviewNames.has(firstName);
}

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

export async function canReturnLoanToReview(db: PrismaClient, scope: UserDataScope, context: {
  actorUserId: string; officeId: string; principalMinor: bigint; currencyCode: string;
}) {
  if (scope.officeIds && !scope.officeIds.includes(context.officeId)) return false;
  const actor = await db.user.findUnique({
    where: { id: context.actorUserId },
    select: { name: true, systemRole: true, organizationId: true, banned: true },
  });
  if (!actor || actor.banned || actor.organizationId !== scope.organizationId) return false;
  if (isAutomaticReturnToReviewUser(actor)) return true;
  return canReturnLoanToDraft(db, scope, context);
}

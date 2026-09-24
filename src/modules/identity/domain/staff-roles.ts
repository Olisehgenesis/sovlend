import type { Prisma, UserRole } from "@prisma/client";

/**
 * System roles that represent actual operational staff -- eligible to be assigned as a client's
 * or loan's field officer. Deliberately excludes CLIENT, INVESTOR, TREASURY_SIGNER, AUDITOR and
 * SYSTEM: those users may exist in the same office/organization but are never who you'd pick from
 * an "assign staff" or "loan officer" dropdown.
 */
export const STAFF_SYSTEM_ROLES: readonly UserRole[] = ["ADMIN", "GENERAL_MANAGER", "BRANCH_MANAGER", "TELLER", "LOAN_OFFICER"];

/**
 * Staff who can be picked as loan/group/client officer. Archived (banned) accounts stay in Admin
 * but are not assignable. Pass `includeUserId` so an already-assigned archived officer still
 * appears on that one record until it is reassigned.
 */
export function assignableStaffWhere(options?: {
  includeUserId?: string | null;
  officeId?: string | null;
}): Prisma.UserWhereInput {
  const assignable: Prisma.UserWhereInput = {
    systemRole: { in: [...STAFF_SYSTEM_ROLES] },
    NOT: { banned: true },
    ...(options?.officeId ? { officeId: options.officeId } : {}),
  };
  if (!options?.includeUserId) return assignable;
  return { OR: [{ id: options.includeUserId }, assignable] };
}

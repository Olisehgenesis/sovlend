import { cache } from "react";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { loadOrganizationOffices } from "@/modules/identity/application/actor-access";

export type UserDataScope = Readonly<{
  organizationId: string;
  officeIds: readonly string[] | null;
  /**
   * Set to this user's own id when their permission assignment scope is "OWN" (e.g. the
   * "Loan Officer" role) -- meaning they should only ever see loans/clients/groups/savings
   * accounts assigned directly to them, not every record in their office. Null for
   * ORGANIZATION- or OFFICE-scoped users, who keep the existing office-based visibility.
   */
  officerUserId: string | null;
}>;

const cachedUserDataScope = cache((userId: string) => computeUserDataScope(prisma, userId));

export async function getUserDataScope(db: PrismaClient, userId: string): Promise<UserDataScope | null> {
  if (db === prisma) return cachedUserDataScope(userId);
  return computeUserDataScope(db, userId);
}

async function computeUserDataScope(db: PrismaClient, userId: string): Promise<UserDataScope | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      organizationId: true,
      officeId: true,
      permissionAssignments: {
        where: {
          validFrom: { lte: new Date() },
          OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
        },
        select: { scope: true, officeId: true, includeChildOffices: true },
      },
    },
  });
  if (!user?.organizationId) return null;
  if (user.permissionAssignments.some((assignment) => assignment.scope === "ORGANIZATION")) {
    return { organizationId: user.organizationId, officeIds: null, officerUserId: null };
  }

  const officerUserId = user.permissionAssignments.some((assignment) => assignment.scope === "OWN") ? userId : null;

  const assigned = user.permissionAssignments
    .filter((assignment) => assignment.scope === "OFFICE" && assignment.officeId)
    .map((assignment) => ({ officeId: assignment.officeId as string, includeChildren: assignment.includeChildOffices }));
  if (assigned.length === 0 && user.officeId) assigned.push({ officeId: user.officeId, includeChildren: false });
  const officeIds = new Set(assigned.map((assignment) => assignment.officeId));

  if (assigned.some((assignment) => assignment.includeChildren)) {
    const offices = db === prisma
      ? await loadOrganizationOffices(user.organizationId)
      : await db.office.findMany({
          where: { organizationId: user.organizationId },
          select: { id: true, parentId: true },
        });
    let changed = true;
    while (changed) {
      changed = false;
      for (const office of offices) {
        if (office.parentId && officeIds.has(office.parentId) && !officeIds.has(office.id)) {
          officeIds.add(office.id);
          changed = true;
        }
      }
    }
  }

  return { organizationId: user.organizationId, officeIds: [...officeIds], officerUserId };
}

export function officeWhere(scope: UserDataScope) {
  return scope.officeIds ? { officeId: { in: [...scope.officeIds] } } : {};
}

/**
 * Loan-scoped narrowing: when the signed-in user's scope is "OWN" (a Loan Officer), restrict to
 * loans assigned to them specifically instead of every loan in their office. Falls back to the
 * existing office-based filter for everyone else, so this is a drop-in replacement for
 * `officeWhere(scope)` at any call site filtering the Loan model directly.
 */
export function loanScopeWhere(scope: UserDataScope) {
  return scope.officerUserId ? { loanOfficerId: scope.officerUserId } : officeWhere(scope);
}

/** Same as {@link loanScopeWhere}, for the Client model's `assignedOfficerId` column. */
export function clientScopeWhere(scope: UserDataScope) {
  return scope.officerUserId ? { assignedOfficerId: scope.officerUserId } : officeWhere(scope);
}

/** Same as {@link loanScopeWhere}, for the Group model's `staffId` (assigned officer) column. */
export function groupScopeWhere(scope: UserDataScope) {
  return scope.officerUserId ? { staffId: scope.officerUserId } : officeWhere(scope);
}

/** Same as {@link loanScopeWhere}, for the SavingsAccount model's `fieldOfficerId` column. */
export function savingsScopeWhere(scope: UserDataScope) {
  return scope.officerUserId ? { fieldOfficerId: scope.officerUserId } : officeWhere(scope);
}
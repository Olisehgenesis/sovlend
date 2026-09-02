import type { PrismaClient } from "@prisma/client";

export type UserDataScope = Readonly<{
  organizationId: string;
  officeIds: readonly string[] | null;
}>;

export async function getUserDataScope(prisma: PrismaClient, userId: string): Promise<UserDataScope | null> {
  const user = await prisma.user.findUnique({
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
    return { organizationId: user.organizationId, officeIds: null };
  }

  const assigned = user.permissionAssignments
    .filter((assignment) => assignment.scope === "OFFICE" && assignment.officeId)
    .map((assignment) => ({ officeId: assignment.officeId as string, includeChildren: assignment.includeChildOffices }));
  if (assigned.length === 0 && user.officeId) assigned.push({ officeId: user.officeId, includeChildren: false });
  const officeIds = new Set(assigned.map((assignment) => assignment.officeId));

  if (assigned.some((assignment) => assignment.includeChildren)) {
    const offices = await prisma.office.findMany({
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

  return { organizationId: user.organizationId, officeIds: [...officeIds] };
}

export function officeWhere(scope: UserDataScope) {
  return scope.officeIds ? { officeId: { in: [...scope.officeIds] } } : {};
}
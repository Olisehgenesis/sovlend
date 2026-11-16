import { cache } from "react";

import { prisma } from "@/lib/prisma";

const assignmentInclude = {
  group: { include: { permissions: true } },
} as const;

/** One read of this user's groups for the whole request. Later permission checks reuse it. */
export const loadPermissionAssignments = cache(async (userId: string) => {
  return prisma.userPermissionAssignment.findMany({
    where: { userId },
    include: assignmentInclude,
  });
});

/** Offices for one organization, so parent walks do not query one row at a time. */
export const loadOrganizationOffices = cache(async (organizationId: string) => {
  return prisma.office.findMany({
    where: { organizationId },
    select: { id: true, parentId: true },
  });
});

export const loadAccessUser = cache(async (userId: string) => {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      systemRole: true,
      organizationId: true,
      mustChangePassword: true,
      organization: { select: { name: true } },
      office: { select: { name: true } },
    },
  });
});

export const loadOfficeAncestorIds = cache(async (officeId: string) => {
  const office = await prisma.office.findUnique({
    where: { id: officeId },
    select: { organizationId: true },
  });
  if (!office) return [] as string[];
  return officeAncestorIds(await loadOrganizationOffices(office.organizationId), officeId);
});

export function officeAncestorIds(offices: readonly { id: string; parentId: string | null }[], officeId: string) {
  const parents = new Map(offices.map((office) => [office.id, office.parentId]));
  const ancestors: string[] = [];
  let current = parents.get(officeId) ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    ancestors.push(current);
    current = parents.get(current) ?? null;
  }
  return ancestors;
}

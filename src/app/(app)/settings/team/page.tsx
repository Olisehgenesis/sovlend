import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { TeamPermissionsPanel } from "@/components/team-permissions-panel";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPermissionCategories } from "@/modules/identity/application/team-permissions";

export default async function TeamPermissionsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true, organization: { select: { name: true } } },
  });
  if (!actor?.organizationId) redirect("/");

  const now = new Date();
  const [permissionDefinitions, permissionGroups, users] = await Promise.all([
    prisma.permissionDefinition.findMany({ orderBy: { code: "asc" } }),
    prisma.permissionGroup.findMany({
      where: { organizationId: actor.organizationId },
      include: { permissions: { orderBy: { permissionCode: "asc" } } },
      orderBy: [{ system: "desc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        systemRole: true,
        office: { select: { name: true } },
        permissionAssignments: {
          where: {
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            group: { organizationId: actor.organizationId },
          },
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            scope: true,
            includeChildOffices: true,
            office: { select: { name: true } },
            group: { select: { id: true, name: true, system: true } },
          },
        },
      },
    }),
  ]);

  return (
    <TeamPermissionsPanel
      categories={buildPermissionCategories(permissionDefinitions)}
      groups={permissionGroups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        system: group.system,
        permissionCodes: group.permissions.map((permission) => permission.permissionCode),
      }))}
      organizationName={actor.organization?.name ?? "SovLend"}
      permissionCount={permissionDefinitions.length}
      users={users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        systemRole: user.systemRole,
        officeName: user.office?.name ?? null,
        activeAssignments: user.permissionAssignments.map((assignment) => ({
          id: assignment.id,
          scope: assignment.scope,
          includeChildOffices: assignment.includeChildOffices,
          officeName: assignment.office?.name ?? null,
          groupId: assignment.group.id,
          groupName: assignment.group.name,
          systemGroup: assignment.group.system,
        })),
      }))}
    />
  );
}

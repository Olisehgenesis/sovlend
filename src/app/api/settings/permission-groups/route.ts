import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPermissionCategories } from "@/modules/identity/application/team-permissions";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!actor?.organizationId) return NextResponse.json({ error: "Administrator requires an organization" }, { status: 400 });

  const [definitions, groups] = await Promise.all([
    prisma.permissionDefinition.findMany({ orderBy: { code: "asc" } }),
    prisma.permissionGroup.findMany({
      where: { organizationId: actor.organizationId },
      include: { permissions: { orderBy: { permissionCode: "asc" } } },
      orderBy: [{ system: "desc" }, { name: "asc" }],
    }),
  ]);

  return NextResponse.json({
    categories: buildPermissionCategories(definitions),
    permissionDefinitions: definitions,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      system: group.system,
      permissionCodes: group.permissions.map((permission) => permission.permissionCode),
    })),
  });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, groupScopeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { STAFF_SYSTEM_ROLES } from "@/modules/identity/domain/staff-roles";

const schema = z.object({ officerId: z.string().trim().min(1).nullable() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A staff member is required" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const group = await prisma.group.findFirst({
    where: { id, organizationId: scope.organizationId, ...groupScopeWhere(scope) },
    select: { id: true, officeId: true },
  });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.clientManage,
      organizationId: scope.organizationId,
      officeId: group.officeId,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot edit this group" }, { status: 403 });
    throw error;
  }

  if (parsed.data.officerId === null) {
    await prisma.group.update({ where: { id: group.id }, data: { staffId: null } });
    return NextResponse.json({ ok: true });
  }

  const officer = await prisma.user.findFirst({
    where: {
      id: parsed.data.officerId,
      organizationId: scope.organizationId,
      officeId: group.officeId,
      systemRole: { in: [...STAFF_SYSTEM_ROLES] },
    },
  });
  if (!officer) return NextResponse.json({ error: "Staff member not found at this group's office" }, { status: 404 });

  const members = await prisma.groupMember.findMany({ where: { groupId: group.id }, select: { clientId: true } });
  const memberIds = members.map((member) => member.clientId);

  await prisma.$transaction([
    prisma.group.update({ where: { id: group.id }, data: { staffId: officer.id } }),
    prisma.loan.updateMany({ where: { groupId: group.id }, data: { loanOfficerId: officer.id } }),
    prisma.savingsAccount.updateMany({ where: { groupId: group.id }, data: { fieldOfficerId: officer.id } }),
    prisma.client.updateMany({ where: { id: { in: memberIds } }, data: { assignedOfficerId: officer.id } }),
    prisma.loan.updateMany({ where: { clientId: { in: memberIds } }, data: { loanOfficerId: officer.id } }),
    prisma.savingsAccount.updateMany({ where: { clientId: { in: memberIds } }, data: { fieldOfficerId: officer.id } }),
  ]);

  return NextResponse.json({ ok: true });
}

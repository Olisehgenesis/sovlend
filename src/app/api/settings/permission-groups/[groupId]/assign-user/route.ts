import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { managedAssignmentDefaults } from "@/modules/identity/application/team-permissions";

const bodySchema = z.object({ userId: z.string().trim().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!actor?.organizationId) return NextResponse.json({ error: "Administrator requires an organization" }, { status: 400 });

  const { groupId } = await params;
  const [group, user] = await Promise.all([
    prisma.permissionGroup.findFirst({ where: { id: groupId, organizationId: actor.organizationId }, select: { id: true, name: true, system: true } }),
    prisma.user.findFirst({ where: { id: parsed.data.userId, organizationId: actor.organizationId }, select: { id: true, systemRole: true, officeId: true, office: { select: { name: true } } } }),
  ]);

  if (!group) return NextResponse.json({ error: "Permission group not found" }, { status: 404 });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let defaults;
  try {
    defaults = managedAssignmentDefaults(user.systemRole, user.officeId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scope defaults could not be resolved" }, { status: 400 });
  }

  const now = new Date();
  const activeAssignments = await prisma.userPermissionAssignment.findMany({
    where: {
      userId: user.id,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      group: { organizationId: actor.organizationId },
    },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, groupId: true, scope: true, officeId: true },
  });

  const matchingAssignment = await prisma.userPermissionAssignment.findFirst({
    where: { userId: user.id, groupId: group.id, scope: defaults.scope, officeId: defaults.officeId },
    select: { id: true },
  });

  const assignment = await prisma.$transaction(async (transaction) => {
    const retireIds = activeAssignments.map((item) => item.id).filter((id) => id !== matchingAssignment?.id);
    if (retireIds.length > 0) {
      await transaction.userPermissionAssignment.updateMany({ where: { id: { in: retireIds } }, data: { validUntil: now } });
    }

    if (matchingAssignment?.id) {
      return transaction.userPermissionAssignment.update({
        where: { id: matchingAssignment.id },
        data: {
          validFrom: now,
          validUntil: null,
          includeChildOffices: defaults.includeChildOffices,
          approvalLimitMinor: null,
          approvalCurrencyCode: null,
        },
        include: { group: { select: { id: true, name: true, system: true } }, office: { select: { name: true } } },
      });
    }

    return transaction.userPermissionAssignment.create({
      data: {
        userId: user.id,
        groupId: group.id,
        scope: defaults.scope,
        officeId: defaults.officeId,
        includeChildOffices: defaults.includeChildOffices,
      },
      include: { group: { select: { id: true, name: true, system: true } }, office: { select: { name: true } } },
    });
  });

  return NextResponse.json({
    ok: true,
    assignment: {
      id: assignment.id,
      groupId: assignment.group.id,
      groupName: assignment.group.name,
      systemGroup: assignment.group.system,
      scope: assignment.scope,
      officeName: assignment.office?.name ?? null,
      includeChildOffices: assignment.includeChildOffices,
    },
  });
}

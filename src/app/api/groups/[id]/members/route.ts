import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({ clientAccountNumber: z.string().trim().min(1).max(60) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid member" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const group = await prisma.group.findFirst({ where: { id, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.clientManage, organizationId: scope.organizationId, officeId: group.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot edit this group" }, { status: 403 });
    throw error;
  }

  const client = await prisma.client.findFirst({ where: { accountNumber: parsed.data.clientAccountNumber, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "No client found with that account number in your scope" }, { status: 404 });

  const existing = await prisma.groupMember.findFirst({ where: { groupId: group.id, clientId: client.id } });
  if (existing) return NextResponse.json({ error: "Client is already a member of this group" }, { status: 409 });

  const member = await prisma.groupMember.create({ data: { groupId: group.id, clientId: client.id } });
  return NextResponse.json({ id: member.id }, { status: 201 });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  middleName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().min(1).max(150),
  relationship: z.string().trim().max(80).optional(),
  genderCode: z.string().trim().max(50).optional(),
  mobileNumber: z.string().trim().max(30).optional(),
  age: z.number().int().min(0).max(130).optional(),
  isDependent: z.boolean().default(false),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid family member" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const client = await prisma.client.findFirst({ where: { id, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.clientManage, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot edit this client" }, { status: 403 });
    throw error;
  }

  const member = await prisma.clientFamilyMember.create({ data: { clientId: client.id, ...parsed.data, middleName: parsed.data.middleName || null, relationship: parsed.data.relationship || null, genderCode: parsed.data.genderCode || null, mobileNumber: parsed.data.mobileNumber || null, age: parsed.data.age ?? null } });
  return NextResponse.json({ id: member.id }, { status: 201 });
}

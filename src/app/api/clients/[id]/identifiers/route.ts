import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({
  documentType: z.string().trim().min(1).max(80),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  uniqueNumber: z.string().trim().min(1).max(120),
  description: z.string().trim().max(255).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid identity" }, { status: 400 });
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

  const existing = await prisma.clientIdentifier.findFirst({ where: { clientId: client.id, documentType: parsed.data.documentType, uniqueNumber: parsed.data.uniqueNumber } });
  if (existing) return NextResponse.json({ error: "This identity is already recorded for the client" }, { status: 409 });

  const identifier = await prisma.clientIdentifier.create({ data: { clientId: client.id, documentType: parsed.data.documentType, status: parsed.data.status, uniqueNumber: parsed.data.uniqueNumber, description: parsed.data.description || null } });
  return NextResponse.json({ id: identifier.id }, { status: 201 });
}

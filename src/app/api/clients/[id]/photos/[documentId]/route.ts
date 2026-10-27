import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { clientScopeWhere, getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

async function authorizedPhoto(clientId: string, documentId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return { error: NextResponse.json({ error: "Workspace assignment required" }, { status: 403 }) };
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: scope.organizationId, ...clientScopeWhere(scope) },
    select: { id: true, officeId: true, photoDocumentId: true },
  });
  if (!client) return { error: NextResponse.json({ error: "Client not found" }, { status: 404 }) };
  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.clientManage, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { error: NextResponse.json({ error: "You cannot edit this client" }, { status: 403 }) };
    throw error;
  }
  const document = await prisma.document.findFirst({ where: { id: documentId, clientId: client.id } });
  if (!document || (!document.isProfilePhoto && document.id !== client.photoDocumentId)) return { error: NextResponse.json({ error: "Profile photo not found" }, { status: 404 }) };
  return { client, document };
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await params;
  const authorized = await authorizedPhoto(id, documentId);
  if ("error" in authorized && authorized.error) return authorized.error;
  await prisma.$transaction([
    prisma.document.update({ where: { id: documentId }, data: { isProfilePhoto: true } }),
    prisma.client.update({ where: { id }, data: { photoDocumentId: documentId } }),
  ]);
  return NextResponse.json({ id: documentId });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await params;
  const authorized = await authorizedPhoto(id, documentId);
  if ("error" in authorized && authorized.error) return authorized.error;
  const { client, document } = authorized;
  if (!client || !document) return NextResponse.json({ error: "Profile photo not found" }, { status: 404 });
  const nextPrimary = client.photoDocumentId === document.id
    ? await prisma.document.findFirst({
        where: { clientId: client.id, isProfilePhoto: true, id: { not: document.id } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;
  const linkedElsewhere = Boolean(document.identifierId || document.familyMemberId || document.loanId || document.collateralId);
  await prisma.$transaction(async (tx) => {
    if (client.photoDocumentId === document.id) {
      await tx.client.update({ where: { id: client.id }, data: { photoDocumentId: nextPrimary?.id ?? null } });
    }
    if (linkedElsewhere) await tx.document.update({ where: { id: document.id }, data: { isProfilePhoto: false } });
    else await tx.document.delete({ where: { id: document.id } });
  });
  return NextResponse.json({ id: document.id });
}

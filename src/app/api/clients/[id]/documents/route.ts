import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { storeDocumentBytes } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const identifierId = String(formData.get("identifierId") ?? "").trim();
  const familyMemberId = String(formData.get("familyMemberId") ?? "").trim();
  const setAsPhoto = formData.get("setAsPhoto") === "on";
  const setAsSignature = formData.get("setAsSignature") === "on";
  const file = formData.get("file");
  if (!name) return NextResponse.json({ error: "Document name is required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "File must be between 1 byte and 15MB" }, { status: 400 });
  if (identifierId) {
    const identifier = await prisma.clientIdentifier.findFirst({ where: { id: identifierId, clientId: client.id } });
    if (!identifier) return NextResponse.json({ error: "Identity not found" }, { status: 404 });
  }
  if (familyMemberId) {
    const familyMember = await prisma.clientFamilyMember.findFirst({ where: { id: familyMemberId, clientId: client.id } });
    if (!familyMember) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = await storeDocumentBytes(bytes);

  const document = await prisma.document.create({ data: { clientId: client.id, name, description: description || null, objectKey: sha256, sha256, mediaType: file.type || "application/octet-stream", identifierId: identifierId || null, familyMemberId: familyMemberId || null } });
  if (setAsPhoto) await prisma.client.update({ where: { id: client.id }, data: { photoDocumentId: document.id } });
  if (setAsSignature) await prisma.client.update({ where: { id: client.id }, data: { signatureDocumentId: document.id } });
  return NextResponse.json({ id: document.id }, { status: 201 });
}

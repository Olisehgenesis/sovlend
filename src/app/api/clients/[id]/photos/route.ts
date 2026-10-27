import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { storeDocumentBytes } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { clientScopeWhere, getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { MAX_PROFILE_PHOTO_BYTES, MAX_PROFILE_PHOTOS, profileImageType } from "@/modules/clients/domain/profile-image";

async function authorizedClient(clientId: string) {
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
  return { client };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorized = await authorizedClient(id);
  if ("error" in authorized && authorized.error) return authorized.error;
  const client = authorized.client;
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Choose at least one photo" }, { status: 400 });
  const existing = await prisma.document.count({ where: { clientId: client.id, isProfilePhoto: true } });
  if (existing + files.length > MAX_PROFILE_PHOTOS) {
    return NextResponse.json({ error: `A client can have up to ${MAX_PROFILE_PHOTOS} profile photos` }, { status: 400 });
  }

  const prepared: { name: string; bytes: Buffer; mediaType: string }[] = [];
  for (const [index, file] of files.entries()) {
    const mediaType = profileImageType(file.type);
    if (!mediaType) return NextResponse.json({ error: "Profile photos must be JPEG, PNG, WebP, GIF, or HEIC images" }, { status: 400 });
    if (file.size > MAX_PROFILE_PHOTO_BYTES) return NextResponse.json({ error: "Each profile photo must be 8MB or smaller" }, { status: 400 });
    prepared.push({ name: file.name.trim() || `Profile photo ${existing + index + 1}`, bytes: Buffer.from(await file.arrayBuffer()), mediaType });
  }

  const replacePrimary = formData.get("setPrimary") === "on" || !client.photoDocumentId;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const photo of prepared) {
        const sha256 = await storeDocumentBytes(photo.bytes);
        const row = await tx.document.create({
          data: { clientId: client.id, name: photo.name, description: "Profile photo", objectKey: sha256, sha256, mediaType: photo.mediaType, isProfilePhoto: true },
        });
        ids.push(row.id);
      }
      if (replacePrimary && ids[0]) await tx.client.update({ where: { id: client.id }, data: { photoDocumentId: ids[0] } });
      return ids;
    });
    return NextResponse.json({ ids: created }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "This exact photo is already stored" }, { status: 409 });
    }
    throw error;
  }
}

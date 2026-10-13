import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { readDocumentBytes, storeDocumentBytes } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { createHash, randomUUID } from "node:crypto";

async function context(profileId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized", status: 401 } as const;
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return { error: "Workspace required", status: 403 } as const;
  if (!z.uuid().safeParse(profileId).success) return { error: "Invalid guarantor ID", status: 400 } as const;
  const profile = await prisma.guarantorProfile.findFirst({
    where: { id: profileId, application: { office: { organizationId: scope.organizationId }, ...officeWhere(scope) } },
    include: { application: true },
  });
  if (!profile) return { error: "Guarantor not found", status: 404 } as const;
  return { profile, session, scope };
}

export async function GET(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const ctx = await context((await params).profileId);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const documentId = new URL(request.url).searchParams.get("documentId");
  if (!z.uuid().safeParse(documentId).success) return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  const document = await prisma.guarantorDocument.findFirst({ where: { id: documentId!, profileId: ctx.profile.id } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const bytes = await readDocumentBytes(document.sha256);
  return new NextResponse(new Uint8Array(bytes), { headers: {
    "Content-Type": document.mediaType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
  } });
}

export async function POST(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const ctx = await context((await params).profileId);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const allowed = await new AuthorizationService(prisma).isAllowed({
    actorUserId: ctx.session.user.id, organizationId: ctx.scope.organizationId,
    officeId: ctx.profile.application.officeId, permission: permissions.loanApply,
  });
  if (!allowed) return NextResponse.json({ error: "You cannot upload guarantor documents" }, { status: 403 });
  if (ctx.profile.application.status !== "SUBMITTED" && ctx.profile.application.status !== "DRAFT") return NextResponse.json({ error: "Guarantor documents are locked after approval" }, { status: 409 });
  const form = await request.formData();
  const name = z.string().trim().min(1).max(150).safeParse(form.get("name"));
  const file = form.get("file");
  if (!name.success || !(file instanceof File) || !file.size || file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Provide a document name and a file between 1 byte and 15MB" }, { status: 400 });
  const sha256 = await storeDocumentBytes(Buffer.from(await file.arrayBuffer()));
  const document = await prisma.$transaction(async (tx) => {
    const lock = await tx.loanApplication.updateMany({
      where: { id: ctx.profile.applicationId, status: ctx.profile.application.status, updatedAt: ctx.profile.application.updatedAt },
      data: { updatedAt: new Date() },
    });
    if (!lock.count) return null;
    const doc = await tx.guarantorDocument.create({ data: { profileId: ctx.profile.id, uploadedById: ctx.session.user.id, name: name.data, sha256, mediaType: file.type || "application/octet-stream" } });
    const correlationId = randomUUID();
    const action = "loan.application.guarantor.document.added";
    const metadata = { profileId: ctx.profile.id, documentId: doc.id };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: ctx.session.user.id, action, entityType: "GuarantorProfile", entityId: ctx.profile.id, correlationId, metadata, eventHash } });
    return doc;
  });
  if (!document) return NextResponse.json({ error: "Application changed. Refresh and try again" }, { status: 409 });
  return NextResponse.json({ id: document.id }, { status: 201 });
}

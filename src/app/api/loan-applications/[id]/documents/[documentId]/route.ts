import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { readDocumentBytes } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, documentId } = await params;
  const application = await prisma.loanApplication.findFirst({ where: { id, office: { organizationId: scope.organizationId } } });
  if (!application || (scope.officeIds && !scope.officeIds.includes(application.officeId))) {
    return NextResponse.json({ error: "Loan application not found" }, { status: 404 });
  }
  const document = await prisma.loanApplicationDocument.findFirst({ where: { id: documentId, applicationId: application.id } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  try {
    const bytes = await readDocumentBytes(document.sha256);
    const disposition = document.mediaType.startsWith("image/") ? "inline" : "attachment";
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": document.mediaType, "Content-Disposition": `${disposition}; filename="${document.name.replaceAll('"', "")}"` } });
  } catch {
    return NextResponse.json({ error: "Stored file is missing" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, documentId } = await params;
  const application = await prisma.loanApplication.findFirst({ where: { id, office: { organizationId: scope.organizationId } } });
  if (!application || (scope.officeIds && !scope.officeIds.includes(application.officeId))) {
    return NextResponse.json({ error: "Loan application not found" }, { status: 404 });
  }

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.loanApply,
      organizationId: scope.organizationId,
      officeId: application.officeId,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "You cannot remove documents for this application" }, { status: 403 });
    }
    throw error;
  }

  const document = await prisma.loanApplicationDocument.findFirst({ where: { id: documentId, applicationId: application.id } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  await prisma.loanApplicationDocument.delete({ where: { id: document.id } });
  return NextResponse.json({ ok: true });
}

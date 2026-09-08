import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { storeDocumentBytes } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const MAX_BYTES = 15 * 1024 * 1024;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; collateralId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, collateralId } = await params;
  const loan = await prisma.loan.findFirst({
    where: { id, office: { organizationId: scope.organizationId } },
    select: { id: true, officeId: true },
  });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  const collateral = await prisma.loanCollateral.findFirst({
    where: { id: collateralId, loanId: loan.id },
    include: { documents: { orderBy: { createdAt: "desc" } } },
  });
  if (!collateral) return NextResponse.json({ error: "Collateral not found" }, { status: 404 });

  return NextResponse.json({
    documents: collateral.documents.map((document) => ({
      id: document.id,
      name: document.name,
      description: document.description,
      mediaType: document.mediaType,
      createdAt: document.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; collateralId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, collateralId } = await params;
  const loan = await prisma.loan.findFirst({
    where: { id, office: { organizationId: scope.organizationId } },
    select: { id: true, officeId: true, clientId: true },
  });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.clientManage,
      organizationId: scope.organizationId,
      officeId: loan.officeId,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "You cannot upload documents for this collateral" }, { status: 403 });
    }
    throw error;
  }

  const collateral = await prisma.loanCollateral.findFirst({
    where: { id: collateralId, loanId: loan.id },
    select: { id: true },
  });
  if (!collateral) return NextResponse.json({ error: "Collateral not found" }, { status: 404 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const file = formData.get("file");
  if (!name) return NextResponse.json({ error: "Document name is required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be between 1 byte and 15MB" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = await storeDocumentBytes(bytes);

  const document = await prisma.document.create({
    data: {
      clientId: loan.clientId,
      loanId: loan.id,
      collateralId: collateral.id,
      name,
      description: description || null,
      objectKey: sha256,
      sha256,
      mediaType: file.type || "application/octet-stream",
    },
  });

  return NextResponse.json({ id: document.id }, { status: 201 });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { canEditSubmittedLoanApplication } from "@/modules/lending/application/loan-application-access";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid application ID" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace required" }, { status: 403 });
  const application = await prisma.loanApplication.findFirst({ where: { id: id.data, office: { organizationId: scope.organizationId }, ...officeWhere(scope) }, include: { product: true } });
  if (!application) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true } });
  if (!canEditSubmittedLoanApplication({ actorUserId: session.user.id, actorSystemRole: actor?.systemRole, submittedById: application.submittedById }) ||
    !await new AuthorizationService(prisma).isAllowed({ actorUserId: session.user.id, permission: permissions.loanApply, organizationId: scope.organizationId, officeId: application.officeId })) return NextResponse.json({ error: "You cannot submit this draft" }, { status: 403 });
  if (application.status !== "DRAFT") return NextResponse.json({ error: "Only drafts can be submitted" }, { status: 409 });
  if (application.proposedPrincipalMinor <= 0n || application.proposedPrincipalMinor < application.product.principalMinMinor || application.proposedPrincipalMinor > application.product.principalMaxMinor) return NextResponse.json({ error: "Principal is outside the product range" }, { status: 400 });
  const success = await prisma.$transaction(async tx => {
    const changed = await tx.loanApplication.updateMany({ where: { id: application.id, status: "DRAFT", updatedAt: application.updatedAt }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedById: session.user.id } });
    if (!changed.count) return false;
    const correlationId = randomUUID(); const action = "loan.application.resubmitted";
    const metadata = { applicationId: application.id };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: session.user.id, action, entityType: "LoanApplication", entityId: application.id, correlationId, metadata, eventHash } });
    return true;
  });
  return success ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Draft changed. Refresh and try again" }, { status: 409 });
}

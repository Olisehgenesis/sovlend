import { createHash, randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  buildChargeSnapshot,
  buildCollateralSnapshot,
  buildTermsSnapshot,
  createLoanApplicationSchema,
} from "@/modules/lending/application/loan-application-payload";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createLoanApplicationSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid application" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const [owner, product, loanOfficer, fund] = await Promise.all([
    parsed.data.clientId
      ? prisma.client.findFirst({ where: { id: parsed.data.clientId, organizationId: scope.organizationId } })
      : prisma.group.findFirst({ where: { id: parsed.data.groupId, organizationId: scope.organizationId } }),
    prisma.loanProduct.findFirst({ where: { id: parsed.data.productId, organizationId: scope.organizationId, active: true } }),
    parsed.data.loanOfficerId
      ? prisma.user.findFirst({ where: { id: parsed.data.loanOfficerId, organizationId: scope.organizationId, systemRole: "LOAN_OFFICER" } })
      : null,
    parsed.data.fundId
      ? prisma.fund.findFirst({ where: { id: parsed.data.fundId, organizationId: scope.organizationId, isActive: true } })
      : null,
  ]);
  const ownerLabel = parsed.data.clientId ? "Client" : "Group";
  if (!owner || !product) return NextResponse.json({ error: `${ownerLabel} or loan product not found` }, { status: 404 });
  if (parsed.data.loanOfficerId && !loanOfficer) return NextResponse.json({ error: "Selected loan officer was not found" }, { status: 404 });
  if (parsed.data.fundId && !fund) return NextResponse.json({ error: "Selected fund was not found" }, { status: 404 });
  if (scope.officeIds && !scope.officeIds.includes(owner.officeId)) return NextResponse.json({ error: `${ownerLabel} is outside your office scope` }, { status: 403 });
  if (parsed.data.clientId && (owner as { status: string }).status !== "ACTIVE") return NextResponse.json({ error: "Only active clients can apply for loans" }, { status: 400 });
  if (parsed.data.groupId && (owner as { status: string }).status !== "ACTIVE") return NextResponse.json({ error: "Only active groups can apply for loans" }, { status: 400 });

  const principal = BigInt(parsed.data.proposedPrincipalMinor);
  if (principal < product.principalMinMinor || principal > product.principalMaxMinor) {
    return NextResponse.json({ error: "Requested principal is outside the selected product range" }, { status: 400 });
  }
  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.loanApply, organizationId: scope.organizationId, officeId: owner.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot create loan applications for this office" }, { status: 403 });
    throw error;
  }

  const id = randomUUID();
  const correlationId = randomUUID();
  const metadata = { clientId: parsed.data.clientId ?? null, groupId: parsed.data.groupId ?? null, productId: product.id, proposedPrincipalMinor: principal.toString() };
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.application.submitted", metadata })).digest("hex");
  const application = await prisma.$transaction(async (transaction) => {
    const created = await transaction.loanApplication.create({
      data: {
        id,
        clientId: parsed.data.clientId ?? null,
        groupId: parsed.data.groupId ?? null,
        officeId: owner.officeId,
        productId: product.id,
        loanOfficerId: parsed.data.loanOfficerId ?? null,
        fundId: fund?.id ?? null,
        proposedPrincipalMinor: principal,
        purpose: parsed.data.purpose || null,
        externalId: parsed.data.externalId || null,
        applicationExpiresOn: parsed.data.applicationExpiresOn ? new Date(`${parsed.data.applicationExpiresOn}T00:00:00.000Z`) : null,
        termsSnapshot: buildTermsSnapshot(parsed.data.terms),
        chargesSnapshot: buildChargeSnapshot(parsed.data.charges),
        collateralSnapshot: buildCollateralSnapshot(parsed.data.collateral),
        status: "SUBMITTED",
        submittedById: session.user.id,
        submittedAt: new Date(),
      },
    });
    await transaction.auditEvent.create({ data: { actorId: session.user.id, action: "loan.application.submitted", entityType: "LoanApplication", entityId: created.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "LoanApplication", aggregateId: created.id, eventType: "loan.application.submitted", payload: metadata } });
    return created;
  });
  return NextResponse.json({ id: application.id, status: application.status }, { status: 201 });
}

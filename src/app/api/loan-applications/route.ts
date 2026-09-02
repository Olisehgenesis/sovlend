import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({
  clientId: z.string().uuid(),
  productId: z.string().uuid(),
  proposedPrincipalMinor: z.string().regex(/^\d+$/),
  purpose: z.string().trim().max(1_000).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid application" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const [client, product] = await Promise.all([
    prisma.client.findFirst({ where: { id: parsed.data.clientId, organizationId: scope.organizationId } }),
    prisma.loanProduct.findFirst({ where: { id: parsed.data.productId, organizationId: scope.organizationId, active: true } }),
  ]);
  if (!client || !product) return NextResponse.json({ error: "Client or loan product not found" }, { status: 404 });
  if (scope.officeIds && !scope.officeIds.includes(client.officeId)) return NextResponse.json({ error: "Client is outside your office scope" }, { status: 403 });
  if (client.status !== "ACTIVE") return NextResponse.json({ error: "Only active clients can apply for loans" }, { status: 400 });

  const principal = BigInt(parsed.data.proposedPrincipalMinor);
  if (principal < product.principalMinMinor || principal > product.principalMaxMinor) {
    return NextResponse.json({ error: "Requested principal is outside the selected product range" }, { status: 400 });
  }
  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.loanApply, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot create loan applications for this office" }, { status: 403 });
    throw error;
  }

  const id = randomUUID();
  const correlationId = randomUUID();
  const metadata = { clientId: client.id, productId: product.id, proposedPrincipalMinor: principal.toString() };
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.application.submitted", metadata })).digest("hex");
  const application = await prisma.$transaction(async (transaction) => {
    const created = await transaction.loanApplication.create({ data: { id, clientId: client.id, productId: product.id, proposedPrincipalMinor: principal, purpose: parsed.data.purpose || null, status: "SUBMITTED", submittedById: session.user.id, submittedAt: new Date() } });
    await transaction.auditEvent.create({ data: { actorId: session.user.id, action: "loan.application.submitted", entityType: "LoanApplication", entityId: created.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "LoanApplication", aggregateId: created.id, eventType: "loan.application.submitted", payload: metadata } });
    return created;
  });
  return NextResponse.json({ id: application.id, status: application.status }, { status: 201 });
}
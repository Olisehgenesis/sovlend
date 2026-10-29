import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { canBypassOriginationMakerChecker } from "@/modules/lending/application/loan-application-access";
import { loanServiceActionTypes, requestLoanServiceAction } from "@/modules/lending/application/loan-service-actions";

const createSchema = z.object({
  actionType: z.enum(loanServiceActionTypes),
  reason: z.string().trim().min(1).max(1000).optional(),
  idempotencyKey: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const loan = await prisma.loan.findFirst({ where: { id: (await params).id, office: { organizationId: scope.organizationId } } });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  const requests = await prisma.loanServiceRequest.findMany({
    where: { loanId: loan.id },
    include: { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
    orderBy: { requestedAt: "desc" },
  });
  const authorization = new AuthorizationService(prisma);
  const context = { actorUserId: session.user.id, organizationId: scope.organizationId, officeId: loan.officeId };
  const [canManageReversals, canCancelDirectly, actor] = await Promise.all([
    authorization.isAllowed({ ...context, permission: permissions.loanReverse }),
    authorization.isAllowed({ ...context, permission: permissions.loanRepaymentReverse }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true } }),
  ]);
  const canDecideOwnServicing = canBypassOriginationMakerChecker(actor?.systemRole);

  return NextResponse.json({
    requests: requests.map((item) => ({
      id: item.id,
      actionType: item.actionType,
      status: item.status,
      reason: item.reason,
      payload: item.payload,
      requestedByName: item.requestedBy.name,
      requestedAt: item.requestedAt.toISOString(),
      decidedByName: item.decidedBy?.name ?? null,
      decidedAt: item.decidedAt?.toISOString() ?? null,
      decisionNote: item.decisionNote,
      canDecide: item.status === "PENDING" && (
        (item.actionType === "TRANSACTION_REVERSAL" && canCancelDirectly) ||
        (canManageReversals && (item.requestedById !== session.user.id || canDecideOwnServicing))
      ),
      isOwnRequest: item.requestedById === session.user.id,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid servicing request" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const loan = await prisma.loan.findFirst({ where: { id: (await params).id, office: { organizationId: scope.organizationId } } });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  try {
    const created = await requestLoanServiceAction(prisma, {
      loanId: loan.id,
      actorUserId: session.user.id,
      actionType: parsed.data.actionType,
      reason: parsed.data.reason,
      payload: parsed.data.payload,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ id: created.id, status: created.status }, { status: 201 });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to request this servicing action" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Servicing action request failed" }, { status: 400 });
  }
}

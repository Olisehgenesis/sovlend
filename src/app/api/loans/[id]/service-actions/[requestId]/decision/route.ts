import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { decideLoanServiceAction } from "@/modules/lending/application/loan-service-actions";

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = decisionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid decision" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, requestId } = await params;
  const serviceRequest = await prisma.loanServiceRequest.findFirst({ where: { id: requestId, loanId: id, loan: { client: { organizationId: scope.organizationId } } }, include: { loan: true } });
  if (!serviceRequest || (scope.officeIds && !scope.officeIds.includes(serviceRequest.loan.officeId))) {
    return NextResponse.json({ error: "Servicing request not found" }, { status: 404 });
  }

  try {
    const decided = await decideLoanServiceAction(prisma, {
      requestId: serviceRequest.id,
      actorUserId: session.user.id,
      decision: parsed.data.decision,
      note: parsed.data.note,
    });
    return NextResponse.json({ id: decided.id, status: decided.status, resultTransactionId: decided.resultTransactionId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to decide this servicing action" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Decision could not be recorded" }, { status: 400 });
  }
}

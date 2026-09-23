import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { undoLoanDisbursalNow } from "@/modules/lending/application/loan-service-actions";

const schema = z.object({
  businessDate: z.iso.date(),
  reason: z.string().trim().min(1).max(1000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid undo request" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const loan = await prisma.loan.findFirst({
    where: { id: (await params).id, office: { organizationId: scope.organizationId } },
  });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  try {
    const reversalTransactionId = await undoLoanDisbursalNow(prisma, {
      loanId: loan.id,
      actorUserId: session.user.id,
      businessDate: parsed.data.businessDate,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ reversalTransactionId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "You do not have permission to undo this disbursement" }, { status: 403 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not undo this disbursement" }, { status: 400 });
  }
}

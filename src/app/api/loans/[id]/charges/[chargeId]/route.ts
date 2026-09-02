import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({ status: z.enum(["PENDING", "PAID", "WAIVED"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; chargeId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, chargeId } = await params;
  const loan = await prisma.loan.findFirst({ where: { id, client: { organizationId: scope.organizationId } } });
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
      return NextResponse.json({ error: "You cannot edit charges for this loan" }, { status: 403 });
    }
    throw error;
  }

  const charge = await prisma.charge.findFirst({ where: { id: chargeId, loanId: loan.id } });
  if (!charge) return NextResponse.json({ error: "Charge not found" }, { status: 404 });

  await prisma.charge.update({ where: { id: charge.id }, data: { status: parsed.data.status } });
  return NextResponse.json({ ok: true });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, loanScopeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({ officerId: z.string().trim().min(1).nullable() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A staff member is required" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const loan = await prisma.loan.findFirst({ where: { id, office: { organizationId: scope.organizationId }, ...loanScopeWhere(scope) } });
  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.clientManage, organizationId: scope.organizationId, officeId: loan.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot edit this loan" }, { status: 403 });
    throw error;
  }

  if (parsed.data.officerId === null) {
    await prisma.loan.update({ where: { id: loan.id }, data: { loanOfficerId: null } });
    return NextResponse.json({ ok: true });
  }

  const officer = await prisma.user.findFirst({ where: { id: parsed.data.officerId, organizationId: scope.organizationId, officeId: loan.officeId } });
  if (!officer) return NextResponse.json({ error: "Staff member not found at this loan's office" }, { status: 404 });

  await prisma.loan.update({ where: { id: loan.id }, data: { loanOfficerId: officer.id } });
  return NextResponse.json({ ok: true });
}

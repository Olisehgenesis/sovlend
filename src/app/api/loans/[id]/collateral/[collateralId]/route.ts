import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const updateSchema = z.object({
  type: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  estimatedValue: z.coerce.number().positive().nullable().optional(),
  valuationDate: z.iso.date().nullable().optional(),
  status: z.enum(["ACTIVE", "RELEASED", "DISPOSED"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; collateralId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid collateral update" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, collateralId } = await params;
  const loan = await prisma.loan.findFirst({ where: { id, office: { organizationId: scope.organizationId } } });
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
      return NextResponse.json({ error: "You cannot update collateral for this loan" }, { status: 403 });
    }
    throw error;
  }

  const collateral = await prisma.loanCollateral.findFirst({ where: { id: collateralId, loanId: loan.id } });
  if (!collateral) return NextResponse.json({ error: "Collateral not found" }, { status: 404 });

  await prisma.loanCollateral.update({
    where: { id: collateral.id },
    data: {
      type: parsed.data.type,
      description: parsed.data.description === undefined ? undefined : parsed.data.description,
      estimatedValueMinor: parsed.data.estimatedValue === undefined ? undefined : parsed.data.estimatedValue === null ? null : BigInt(Math.round(parsed.data.estimatedValue * 100)),
      valuationDate: parsed.data.valuationDate === undefined ? undefined : parsed.data.valuationDate === null ? null : new Date(`${parsed.data.valuationDate}T00:00:00.000Z`),
      status: parsed.data.status,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; collateralId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, collateralId } = await params;
  const loan = await prisma.loan.findFirst({ where: { id, office: { organizationId: scope.organizationId } } });
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
      return NextResponse.json({ error: "You cannot remove collateral for this loan" }, { status: 403 });
    }
    throw error;
  }

  const collateral = await prisma.loanCollateral.findFirst({ where: { id: collateralId, loanId: loan.id } });
  if (!collateral) return NextResponse.json({ error: "Collateral not found" }, { status: 404 });

  await prisma.loanCollateral.delete({ where: { id: collateral.id } });
  return NextResponse.json({ ok: true });
}

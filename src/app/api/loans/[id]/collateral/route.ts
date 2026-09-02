import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const createSchema = z.object({
  type: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  estimatedValue: z.coerce.number().positive().optional(),
  valuationDate: z.iso.date().optional(),
  status: z.enum(["ACTIVE", "RELEASED", "DISPOSED"]).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const loan = await prisma.loan.findFirst({
    where: { id: (await params).id, client: { organizationId: scope.organizationId } },
    include: { collateralItems: { orderBy: { createdAt: "desc" } } },
  });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  return NextResponse.json({
    collateral: loan.collateralItems.map((item) => ({
      id: item.id,
      type: item.type,
      description: item.description,
      estimatedValueMinor: item.estimatedValueMinor?.toString() ?? null,
      valuationCurrencyCode: item.valuationCurrencyCode,
      valuationDate: item.valuationDate?.toISOString().slice(0, 10) ?? null,
      status: item.status,
      metadata: item.metadata,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid collateral" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const loan = await prisma.loan.findFirst({ where: { id: (await params).id, client: { organizationId: scope.organizationId } } });
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
      return NextResponse.json({ error: "You cannot add collateral for this loan" }, { status: 403 });
    }
    throw error;
  }

  const collateral = await prisma.loanCollateral.create({
    data: {
      loanId: loan.id,
      type: parsed.data.type,
      description: parsed.data.description || null,
      estimatedValueMinor: parsed.data.estimatedValue ? BigInt(Math.round(parsed.data.estimatedValue * 100)) : null,
      valuationDate: parsed.data.valuationDate ? new Date(`${parsed.data.valuationDate}T00:00:00.000Z`) : null,
      status: parsed.data.status ?? "ACTIVE",
    },
  });

  return NextResponse.json({ id: collateral.id }, { status: 201 });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const createSchema = z.object({
  name: z.string().trim().min(1).max(150),
  amount: z.coerce.number().positive(),
  dueOn: z.iso.date().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const loan = await prisma.loan.findFirst({
    where: { id: (await params).id, client: { organizationId: scope.organizationId } },
    include: { charges: { orderBy: { createdAt: "desc" } } },
  });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  const today = new Date();
  const overdueOutstandingMinor = loan.charges.reduce((sum, charge) => {
    if (!charge.dueOn || charge.status !== "PENDING") return sum;
    return charge.dueOn < today ? sum + charge.amountMinor : sum;
  }, 0n);

  return NextResponse.json({
    charges: loan.charges.map((charge) => ({
      id: charge.id,
      name: charge.name,
      amountMinor: charge.amountMinor.toString(),
      currencyCode: charge.currencyCode,
      status: charge.status,
      dueOn: charge.dueOn?.toISOString().slice(0, 10) ?? null,
    })),
    overdueOutstandingMinor: overdueOutstandingMinor.toString(),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid charge" }, { status: 400 });
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
      return NextResponse.json({ error: "You cannot add charges for this loan" }, { status: 403 });
    }
    throw error;
  }

  const amountMinor = BigInt(Math.round(parsed.data.amount * 100));
  const charge = await prisma.charge.create({
    data: {
      clientId: loan.clientId,
      loanId: loan.id,
      name: parsed.data.name,
      amountMinor,
      dueOn: parsed.data.dueOn ? new Date(`${parsed.data.dueOn}T00:00:00.000Z`) : null,
    },
  });

  return NextResponse.json({ id: charge.id }, { status: 201 });
}

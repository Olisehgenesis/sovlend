import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope } from "@/modules/identity/application/data-scope";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const loan = await prisma.loan.findFirst({
    where: { id: (await params).id, office: { organizationId: scope.organizationId } },
    select: {
      officeId: true,
      guarantors: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  return NextResponse.json({
    guarantors: loan.guarantors.map((guarantor) => ({
      id: guarantor.id,
      externalId: guarantor.externalId,
      guarantorType: guarantor.guarantorType,
      firstName: guarantor.firstName,
      lastName: guarantor.lastName,
      phone: guarantor.phone,
      relationship: guarantor.relationship,
      dateOfBirth: guarantor.dateOfBirth?.toISOString() ?? null,
      active: guarantor.active,
      createdAt: guarantor.createdAt.toISOString(),
      updatedAt: guarantor.updatedAt.toISOString(),
    })),
  });
}

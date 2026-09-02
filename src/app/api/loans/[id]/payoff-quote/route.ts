import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { previewLoanPayoff } from "@/modules/lending/application/loan-service-actions";

const querySchema = z.object({ businessDate: z.iso.date(), waivePenalties: z.enum(["true", "false"]).optional() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ businessDate: url.searchParams.get("businessDate"), waivePenalties: url.searchParams.get("waivePenalties") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payoff query" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const loan = await prisma.loan.findFirst({ where: { id: (await params).id, client: { organizationId: scope.organizationId } } });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId))) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  try {
    const quote = await previewLoanPayoff(prisma, {
      loanId: loan.id,
      actorUserId: session.user.id,
      asOfDate: new Date(`${parsed.data.businessDate}T00:00:00.000Z`),
      waivePenalties: parsed.data.waivePenalties === "true",
    });
    return NextResponse.json({
      asOfDate: parsed.data.businessDate,
      waivePenalties: quote.waivePenalties,
      principalOutstandingMinor: quote.principalOutstandingMinor.toString(),
      interestAccruedMinor: quote.interestAccruedMinor.toString(),
      interestWaivedMinor: quote.interestWaivedMinor.toString(),
      feesOutstandingMinor: quote.feesOutstandingMinor.toString(),
      penaltiesCollectedMinor: quote.penaltiesCollectedMinor.toString(),
      penaltiesWaivedMinor: quote.penaltiesWaivedMinor.toString(),
      totalPayoffMinor: quote.totalPayoffMinor.toString(),
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to view the payoff quote" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payoff quote could not be computed" }, { status: 400 });
  }
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

// Mirrors the collateral item shape captured by the wizard (see chargeSelectionSchema's
// sibling in src/app/api/loan-applications/route.ts) so entries appended here are copied
// onto real LoanCollateral rows on approval by approve-loan-application.ts unchanged.
const schema = z.object({
  type: z.string().trim().max(150).optional(),
  description: z.string().trim().max(1_000).optional(),
  estimatedValueMinor: z.string().regex(/^\d+$/).optional(),
});

type CollateralItem = { type?: string; description?: string; estimatedValueMinor?: string };

function asCollateralItems(value: unknown): CollateralItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CollateralItem => Boolean(item) && typeof item === "object");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid collateral item" }, { status: 400 });
  if (!parsed.data.type?.trim() && !parsed.data.description?.trim() && !parsed.data.estimatedValueMinor) {
    return NextResponse.json({ error: "Provide at least a type, description, or value" }, { status: 400 });
  }
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const application = await prisma.loanApplication.findFirst({ where: { id: (await params).id, office: { organizationId: scope.organizationId } } });
  if (!application || (scope.officeIds && !scope.officeIds.includes(application.officeId))) {
    return NextResponse.json({ error: "Loan application not found" }, { status: 404 });
  }
  // Collateral is only stored as a JSON snapshot until approval copies it onto real
  // LoanCollateral rows — editing the snapshot after that point would silently diverge
  // from the loan's actual collateral, so this is locked once the application leaves review.
  if (application.status !== "SUBMITTED") {
    return NextResponse.json({ error: "Only submitted applications awaiting review can have collateral added" }, { status: 409 });
  }

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.loanApply,
      organizationId: scope.organizationId,
      officeId: application.officeId,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "You cannot add collateral for this application" }, { status: 403 });
    }
    throw error;
  }

  const current = asCollateralItems(application.collateralSnapshot);
  const next = [...current, { type: parsed.data.type || undefined, description: parsed.data.description || undefined, estimatedValueMinor: parsed.data.estimatedValueMinor || undefined }];
  await prisma.loanApplication.update({ where: { id: application.id }, data: { collateralSnapshot: next } });

  return NextResponse.json({ ok: true, count: next.length }, { status: 201 });
}

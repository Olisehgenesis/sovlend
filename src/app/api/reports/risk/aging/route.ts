import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { loadAgingReport, parseRiskFilters, serializeRiskReport } from "@/modules/reports/domain/risk-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportAging,
  );
  if (!allowed) return NextResponse.json({ error: "You cannot view the aging report" }, { status: 403 });

  const url = new URL(request.url);
  const report = await loadAgingReport(
    prisma,
    scope,
    parseRiskFilters({
      officeId: url.searchParams.get("officeId") ?? undefined,
      loanOfficerId: url.searchParams.get("loanOfficerId") ?? undefined,
    }),
  );

  return NextResponse.json(serializeRiskReport(report));
}

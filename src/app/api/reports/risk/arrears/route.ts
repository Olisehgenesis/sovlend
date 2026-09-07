import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  arrearsReportCsv,
  loadArrearsReport,
  parseRiskFilters,
  serializeRiskReport,
} from "@/modules/reports/domain/risk-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportArrears,
  );
  if (!allowed) return NextResponse.json({ error: "You cannot view the arrears report" }, { status: 403 });

  const url = new URL(request.url);
  const report = await loadArrearsReport(
    prisma,
    scope,
    parseRiskFilters({
      officeId: url.searchParams.get("officeId") ?? undefined,
      loanOfficerId: url.searchParams.get("loanOfficerId") ?? undefined,
    }),
  );

  if (url.searchParams.get("format")?.toLowerCase() === "csv") {
    return new NextResponse(arrearsReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-arrears-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(serializeRiskReport(report));
}

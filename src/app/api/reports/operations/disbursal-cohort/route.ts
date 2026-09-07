import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  isoDate,
  loadDisbursalCohortReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportDisbursalCohort,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view the disbursal cohort report" },
      { status: 403 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadDisbursalCohortReport(prisma, context.scope, {
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
    loanOfficerId: searchParams.get("loanOfficerId"),
  });

  return NextResponse.json({
    startDate: report.startDate ? isoDate(report.startDate) : null,
    endDate: report.endDate ? isoDate(report.endDate) : null,
    loanOfficerId: report.loanOfficerId,
    rows: report.rows.map((row) => ({
      period: row.period,
      currencyCode: row.currencyCode,
      loanCount: row.loanCount,
      principalMinor: row.principalMinor.toString(),
    })),
    totals: report.totals.map((row) => ({
      currencyCode: row.currencyCode,
      loanCount: row.loanCount,
      principalMinor: row.principalMinor.toString(),
    })),
  });
}

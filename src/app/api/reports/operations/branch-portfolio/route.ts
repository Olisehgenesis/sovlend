import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  isoDate,
  loadBranchPortfolioReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportBranchPortfolio,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view the branch portfolio report" },
      { status: 403 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadBranchPortfolioReport(prisma, context.scope, {
    parType: searchParams.get("parType"),
    date: searchParams.get("date"),
  });

  return NextResponse.json({
    asOfDate: isoDate(report.asOfDate),
    parDays: report.parDays,
    rows: report.rows.map((row) => ({
      officeId: row.officeId,
      officeName: row.officeName,
      currencyCode: row.currencyCode,
      activeLoanCount: row.activeLoanCount,
      atRiskLoanCount: row.atRiskLoanCount,
      outstandingPrincipalMinor: row.outstandingPrincipalMinor.toString(),
      disbursedThisMonthMinor: row.disbursedThisMonthMinor.toString(),
      parPercent: row.parPercent,
    })),
    totals: report.totals.map((row) => ({
      currencyCode: row.currencyCode,
      activeLoanCount: row.activeLoanCount,
      atRiskLoanCount: row.atRiskLoanCount,
      outstandingPrincipalMinor: row.outstandingPrincipalMinor.toString(),
      disbursedThisMonthMinor: row.disbursedThisMonthMinor.toString(),
      parPercent: row.parPercent,
    })),
  });
}

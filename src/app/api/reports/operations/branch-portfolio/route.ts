import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  branchPortfolioReportCsv,
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

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    return new NextResponse(branchPortfolioReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-branch-portfolio-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

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

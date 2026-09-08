import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { loadOperationsReportContext } from "@/modules/reports/domain/operations-report";
import {
  loadSavingsPortfolioByOfficerReport,
  savingsPortfolioByOfficerReportCsv,
} from "@/modules/reports/domain/savings-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportSavingsPortfolioByOfficer,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view the savings portfolio by officer report" },
      { status: 403 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadSavingsPortfolioByOfficerReport(prisma, context.scope, {
    officeId: searchParams.get("officeId"),
    hideZeroBalances: searchParams.get("showZero") !== "1",
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    const csv = savingsPortfolioByOfficerReportCsv(report);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-savings-portfolio-by-officer-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    rows: report.rows.map((row) => ({
      officerId: row.officerId,
      officerName: row.officerName,
      currencyCode: row.currencyCode,
      accountCount: row.accountCount,
      activeAccountCount: row.activeAccountCount,
      totalBalanceMinor: row.totalBalanceMinor.toString(),
      averageBalanceMinor: row.averageBalanceMinor.toString(),
    })),
  });
}

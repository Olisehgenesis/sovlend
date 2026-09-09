import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  isoDate,
  loadOperationsReportContext,
  loadOutstandingBalancesReport,
  outstandingBalancesReportCsv,
} from "@/modules/reports/domain/operations-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportOutstandingBalances,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view the outstanding balances report" },
      { status: 403 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadOutstandingBalancesReport(prisma, context.scope, {
    officeId: searchParams.get("officeId"),
    loanOfficerId: searchParams.get("loanOfficerId"),
    currencyCode: searchParams.get("currencyCode"),
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    return new NextResponse(outstandingBalancesReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-outstanding-balances-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    officeId: report.officeId,
    loanOfficerId: report.loanOfficerId,
    currencyCode: report.currencyCode,
    rows: report.rows.map((row) => ({
      loanId: row.loanId,
      accountNumber: row.accountNumber,
      borrowerName: row.borrowerName,
      officeId: row.officeId,
      officeName: row.officeName,
      loanOfficerId: row.loanOfficerId,
      loanOfficerName: row.loanOfficerName,
      currencyCode: row.currencyCode,
      status: row.status,
      disbursedOn: row.disbursedOn ? isoDate(row.disbursedOn) : null,
      maturesOn: row.maturesOn ? isoDate(row.maturesOn) : null,
      principalOutstandingMinor: row.principalOutstandingMinor.toString(),
      interestOutstandingMinor: row.interestOutstandingMinor.toString(),
      feesOutstandingMinor: row.feesOutstandingMinor.toString(),
      monitoringFeeOutstandingMinor: row.monitoringFeeOutstandingMinor.toString(),
      penaltiesOutstandingMinor: row.penaltiesOutstandingMinor.toString(),
      totalOutstandingMinor: row.totalOutstandingMinor.toString(),
    })),
    totals: report.totals.map((row) => ({
      currencyCode: row.currencyCode,
      loanCount: row.loanCount,
      principalOutstandingMinor: row.principalOutstandingMinor.toString(),
      interestOutstandingMinor: row.interestOutstandingMinor.toString(),
      feesOutstandingMinor: row.feesOutstandingMinor.toString(),
      monitoringFeeOutstandingMinor: row.monitoringFeeOutstandingMinor.toString(),
      penaltiesOutstandingMinor: row.penaltiesOutstandingMinor.toString(),
      totalOutstandingMinor: row.totalOutstandingMinor.toString(),
    })),
  });
}

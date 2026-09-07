import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  disbursalReportCsv,
  isoDate,
  loadDisbursalReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(prisma, session.user.id, permissions.reportDisbursalLedger);
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json({ error: "You are not allowed to view the disbursal report" }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadDisbursalReport(prisma, context.scope, {
    officeId: searchParams.get("officeId"),
    loanOfficerId: searchParams.get("loanOfficerId"),
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    return new NextResponse(disbursalReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-disbursal-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    officeId: report.officeId,
    loanOfficerId: report.loanOfficerId,
    startDate: report.startDate ? isoDate(report.startDate) : null,
    endDate: report.endDate ? isoDate(report.endDate) : null,
    rows: report.rows.map((row) => ({
      loanId: row.loanId,
      accountNumber: row.accountNumber,
      borrowerName: row.borrowerName,
      officeId: row.officeId,
      officeName: row.officeName,
      loanOfficerId: row.loanOfficerId,
      loanOfficerName: row.loanOfficerName,
      productName: row.productName,
      currencyCode: row.currencyCode,
      status: row.status,
      principalMinor: row.principalMinor.toString(),
      disbursedOn: isoDate(row.disbursedOn),
    })),
    totals: report.totals.map((row) => ({
      currencyCode: row.currencyCode,
      loanCount: row.loanCount,
      principalMinor: row.principalMinor.toString(),
    })),
  });
}

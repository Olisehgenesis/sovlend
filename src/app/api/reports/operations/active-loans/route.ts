import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  activeLoansReportCsv,
  isoDate,
  loadActiveLoansReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(prisma, session.user.id, permissions.reportActiveLoans);
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json({ error: "You are not allowed to view the active loans report" }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadActiveLoansReport(prisma, context.scope, {
    officeId: searchParams.get("officeId"),
    loanOfficerId: searchParams.get("loanOfficerId"),
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    return new NextResponse(activeLoansReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-active-loans-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    officeId: report.officeId,
    loanOfficerId: report.loanOfficerId,
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
      annualRateBps: row.annualRateBps,
      disbursedOn: row.disbursedOn ? isoDate(row.disbursedOn) : null,
      maturesOn: row.maturesOn ? isoDate(row.maturesOn) : null,
      principalRepaidMinor: row.principalRepaidMinor.toString(),
      outstandingPrincipalMinor: row.outstandingPrincipalMinor.toString(),
      overduePrincipalMinor: row.overduePrincipalMinor.toString(),
      interestRepaidMinor: row.interestRepaidMinor.toString(),
      outstandingInterestMinor: row.outstandingInterestMinor.toString(),
      overdueInterestMinor: row.overdueInterestMinor.toString(),
      feesRepaidMinor: row.feesRepaidMinor.toString(),
      outstandingFeesMinor: row.outstandingFeesMinor.toString(),
      overdueFeesMinor: row.overdueFeesMinor.toString(),
      penaltiesRepaidMinor: row.penaltiesRepaidMinor.toString(),
      outstandingPenaltiesMinor: row.outstandingPenaltiesMinor.toString(),
      overduePenaltiesMinor: row.overduePenaltiesMinor.toString(),
      outstandingTotalMinor: row.outstandingTotalMinor.toString(),
      daysOverdue: row.daysOverdue,
      overdueSince: row.overdueSince ? isoDate(row.overdueSince) : null,
      agingBucket: row.agingBucket,
    })),
    totals: report.totals.map((row) => ({
      currencyCode: row.currencyCode,
      loanCount: row.loanCount,
      principalMinor: row.principalMinor.toString(),
      outstandingPrincipalMinor: row.outstandingPrincipalMinor.toString(),
      outstandingTotalMinor: row.outstandingTotalMinor.toString(),
    })),
  });
}

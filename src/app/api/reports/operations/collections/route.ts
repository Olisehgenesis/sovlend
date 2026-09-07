import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  collectionsReportCsv,
  isoDate,
  loadCollectionsReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(prisma, session.user.id, permissions.reportCollectionsLog);
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json({ error: "You are not allowed to view the collections report" }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadCollectionsReport(prisma, context.scope, {
    officeId: searchParams.get("officeId"),
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    return new NextResponse(collectionsReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-collections-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    officeId: report.officeId,
    startDate: report.startDate ? isoDate(report.startDate) : null,
    endDate: report.endDate ? isoDate(report.endDate) : null,
    rows: report.rows.map((row) => ({
      transactionId: row.transactionId,
      loanId: row.loanId,
      accountNumber: row.accountNumber,
      borrowerName: row.borrowerName,
      borrowerType: row.borrowerType,
      officeId: row.officeId,
      officeName: row.officeName,
      groupName: row.groupName,
      productName: row.productName,
      currencyCode: row.currencyCode,
      principalMinor: row.principalMinor.toString(),
      interestMinor: row.interestMinor.toString(),
      feesMinor: row.feesMinor.toString(),
      penaltiesMinor: row.penaltiesMinor.toString(),
      othersMinor: row.othersMinor.toString(),
      totalMinor: row.totalMinor.toString(),
      receiptNumber: row.receiptNumber,
      businessDate: isoDate(row.businessDate),
    })),
    totals: report.totals.map((row) => ({
      currencyCode: row.currencyCode,
      transactionCount: row.transactionCount,
      principalMinor: row.principalMinor.toString(),
      interestMinor: row.interestMinor.toString(),
      feesMinor: row.feesMinor.toString(),
      penaltiesMinor: row.penaltiesMinor.toString(),
      othersMinor: row.othersMinor.toString(),
      totalMinor: row.totalMinor.toString(),
    })),
  });
}

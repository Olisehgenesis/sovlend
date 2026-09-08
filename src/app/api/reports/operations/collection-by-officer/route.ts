import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  collectionByOfficerReportCsv,
  isoDate,
  loadCollectionByOfficerReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportCollectionByOfficer,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view the expected daily collection report" },
      { status: 403 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadCollectionByOfficerReport(prisma, context.scope, {
    date: searchParams.get("date"),
    hideZeroCollection: searchParams.get("showZero") !== "1",
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    return new NextResponse(collectionByOfficerReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-collection-by-officer-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    date: isoDate(report.businessDate),
    rows: report.rows.map((row) => ({
      officerId: row.officerId,
      officerName: row.officerName,
      currencyCode: row.currencyCode,
      loanCount: row.loanCount,
      dueTodayMinor: row.dueTodayMinor.toString(),
      overdueArrearsMinor: row.overdueArrearsMinor.toString(),
      expectedTotalMinor: row.expectedTotalMinor.toString(),
    })),
    totals: report.totals.map((row) => ({
      currencyCode: row.currencyCode,
      loanCount: row.loanCount,
      dueTodayMinor: row.dueTodayMinor.toString(),
      overdueArrearsMinor: row.overdueArrearsMinor.toString(),
      expectedTotalMinor: row.expectedTotalMinor.toString(),
    })),
  });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { loadOperationsReportContext } from "@/modules/reports/domain/operations-report";
import {
  isoDate,
  loadSavingsTransactionsReport,
  savingsTransactionsReportCsv,
} from "@/modules/reports/domain/savings-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportSavingsTransactions,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view the savings transactions report" },
      { status: 403 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadSavingsTransactionsReport(prisma, context.scope, {
    officeId: searchParams.get("officeId"),
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    const csv = savingsTransactionsReportCsv(report);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-savings-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    officeId: report.officeId,
    startDate: isoDate(report.startDate),
    endDate: isoDate(report.endDate),
    rows: report.rows.map((row) => ({
      id: row.id,
      businessDate: isoDate(row.businessDate),
      accountNumber: row.accountNumber,
      ownerName: row.ownerName,
      officeName: row.officeName,
      productName: row.productName,
      transactionType: row.transactionType,
      amountMinor: row.amountMinor.toString(),
      currencyCode: row.currencyCode,
      externalReference: row.externalReference,
    })),
  });
}

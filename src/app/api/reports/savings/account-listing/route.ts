import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { loadOperationsReportContext } from "@/modules/reports/domain/operations-report";
import {
  isoDate,
  loadSavingsAccountListingReport,
  savingsAccountListingReportCsv,
} from "@/modules/reports/domain/savings-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportSavingsAccountListing,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view the savings account listing report" },
      { status: 403 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadSavingsAccountListingReport(prisma, context.scope, {
    officeId: searchParams.get("officeId"),
    hideZeroBalances: searchParams.get("showZero") !== "1",
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    const csv = savingsAccountListingReportCsv(report);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-savings-account-listing-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    officeId: report.officeId,
    rows: report.rows.map((row) => ({
      id: row.id,
      accountNumber: row.accountNumber,
      ownerKind: row.ownerKind,
      ownerName: row.ownerName,
      ownerAccountNumber: row.ownerAccountNumber,
      officeId: row.officeId,
      officeName: row.officeName,
      productName: row.productName,
      accountType: row.accountType,
      status: row.status,
      currencyCode: row.currencyCode,
      balanceMinor: row.balanceMinor.toString(),
      fieldOfficerId: row.fieldOfficerId,
      fieldOfficerName: row.fieldOfficerName,
      openedOn: row.openedOn ? isoDate(row.openedOn) : null,
    })),
  });
}

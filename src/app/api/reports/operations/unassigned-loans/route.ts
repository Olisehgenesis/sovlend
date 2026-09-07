import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  isoDate,
  loadOperationsReportContext,
  loadUnassignedLoansReport,
} from "@/modules/reports/domain/operations-report";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportUnassignedLoans,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view unassigned active loans" },
      { status: 403 },
    );
  }

  const report = await loadUnassignedLoansReport(prisma, context.scope);

  return NextResponse.json({
    rows: report.rows.map((row) => ({
      loanId: row.loanId,
      accountNumber: row.accountNumber,
      borrowerName: row.borrowerName,
      borrowerType: row.borrowerType,
      officeName: row.officeName,
      status: row.status,
      principalMinor: row.principalMinor.toString(),
      currencyCode: row.currencyCode,
      disbursedOn: row.disbursedOn ? isoDate(row.disbursedOn) : null,
    })),
    totals: report.totals.map((row) => ({
      currencyCode: row.currencyCode,
      amountMinor: row.amountMinor.toString(),
    })),
  });
}

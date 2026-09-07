import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  clientListingCsv,
  isoDate,
  loadClientListingReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportClientListing,
  );
  if (!context) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  if (!context.allowed) {
    return NextResponse.json(
      { error: "You are not allowed to view the client listing report" },
      { status: 403 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const report = await loadClientListingReport(prisma, context.scope, {
    officeId: searchParams.get("officeId"),
  });

  if (searchParams.get("format")?.toLowerCase() === "csv") {
    const csv = clientListingCsv(report);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-client-listing-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    officeId: report.officeId,
    rows: report.rows.map((row) => ({
      id: row.id,
      accountNumber: row.accountNumber,
      firstName: row.firstName,
      middleName: row.middleName,
      lastName: row.lastName,
      fullName: row.fullName,
      mobileNumber: row.mobileNumber,
      externalId: row.externalId,
      officeId: row.officeId,
      officeName: row.officeName,
      status: row.status,
      kycStatus: row.kycStatus,
      dateOfBirth: row.dateOfBirth ? isoDate(row.dateOfBirth) : null,
      joinedOn: isoDate(row.joinedOn),
    })),
  });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  chartOfAccountsReportCsv,
  currentMonthDateRange,
  getChartOfAccountsReport,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveAccountTypeFilter,
  resolveOfficeFilter,
  serializeChartOfAccountsReport,
  todayDate,
} from "@/modules/reports/domain/accounting-report";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportGeneralLedger,
  );
  if (!allowed) return NextResponse.json({ error: "You cannot view the chart of accounts" }, { status: 403 });

  const url = new URL(request.url);
  const defaults = currentMonthDateRange();
  const offices = await listAccountingReportOffices(prisma, scope);
  const requestedOfficeId = url.searchParams.get("officeId");
  const officeId = resolveOfficeFilter(offices, requestedOfficeId);
  if (requestedOfficeId && !officeId) {
    return NextResponse.json({ error: "Invalid office filter" }, { status: 400 });
  }

  const requestedAccountType = url.searchParams.get("accountType");
  const accountType = resolveAccountTypeFilter(requestedAccountType);
  if (requestedAccountType && !accountType) {
    return NextResponse.json({ error: "Invalid account type filter" }, { status: 400 });
  }

  const { startDate, endDate } = normalizeDateRange(
    parseDateInput(url.searchParams.get("startDate"), defaults.startDate),
    parseDateInput(url.searchParams.get("endDate"), defaults.endDate),
  );
  const report = await getChartOfAccountsReport(prisma, scope, {
    balanceDate: parseDateInput(url.searchParams.get("asOfDate"), todayDate()),
    activityStartDate: startDate,
    activityEndDate: endDate,
    officeId,
    accountType,
    accountId: url.searchParams.get("accountId"),
  });

  if (url.searchParams.get("format")?.toLowerCase() === "csv") {
    return new NextResponse(chartOfAccountsReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sovlend-chart-of-accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(serializeChartOfAccountsReport(report), { headers: { "Cache-Control": "no-store" } });
}

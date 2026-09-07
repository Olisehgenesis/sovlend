import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import {
  currentMonthDateRange,
  getGeneralLedgerReport,
  listAccountingReportAccounts,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveAccountFilter,
  resolveOfficeFilter,
  serializeGeneralLedgerReport,
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
  if (!allowed) return NextResponse.json({ error: "You cannot view the General Ledger report" }, { status: 403 });

  const url = new URL(request.url);
  const defaults = currentMonthDateRange();
  const [offices, accounts] = await Promise.all([
    listAccountingReportOffices(prisma, scope),
    listAccountingReportAccounts(prisma),
  ]);
  const requestedOfficeId = url.searchParams.get("officeId");
  const officeId = resolveOfficeFilter(offices, requestedOfficeId);
  if (requestedOfficeId && !officeId) {
    return NextResponse.json({ error: "Invalid office filter" }, { status: 400 });
  }

  const requestedAccountId = url.searchParams.get("accountId");
  const validAccountId = resolveAccountFilter(accounts, requestedAccountId);
  if (requestedAccountId && !validAccountId) {
    return NextResponse.json({ error: "Invalid account filter" }, { status: 400 });
  }

  const { startDate, endDate } = normalizeDateRange(
    parseDateInput(url.searchParams.get("startDate"), defaults.startDate),
    parseDateInput(url.searchParams.get("endDate"), defaults.endDate),
  );
  const report = await getGeneralLedgerReport(prisma, scope, {
    startDate,
    endDate,
    officeId,
    accountId: validAccountId ?? accounts[0]?.id ?? null,
  });

  return NextResponse.json(serializeGeneralLedgerReport(report), { headers: { "Cache-Control": "no-store" } });
}

import { ReceiptText } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import {
  buildReportQueryString,
  currentMonthDateRange,
  formatDateInputValue,
  formatReportDate,
  getIncomeStatementReport,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveOfficeFilter,
} from "@/modules/reports/domain/accounting-report";

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; officeId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportIncomeStatement,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const defaults = currentMonthDateRange();
  const offices = await listAccountingReportOffices(prisma, scope);
  const { startDate, endDate } = normalizeDateRange(
    parseDateInput(params.startDate, defaults.startDate),
    parseDateInput(params.endDate, defaults.endDate),
  );
  const officeId = resolveOfficeFilter(offices, params.officeId ?? null);
  const report = await getIncomeStatementReport(prisma, scope, { startDate, endDate, officeId });
  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const apiHref = `/api/reports/accounting/income-statement?${buildReportQueryString({
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
    officeId,
  })}`;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Income Statement" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting statements</p>
          <h1>Income Statement</h1>
          <p>
            Profit and loss from {formatReportDate(report.startDate)} to {formatReportDate(report.endDate)} · {activeOfficeName}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
          <a className="secondary-action" href={apiHref}>
            JSON API
          </a>
        </div>
      </header>

      <section className="panel form-panel">
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Filters</legend>
            <div className="form-row three">
              <label>
                Start date
                <input defaultValue={formatDateInputValue(startDate)} name="startDate" required type="date" />
              </label>
              <label>
                End date
                <input defaultValue={formatDateInputValue(endDate)} name="endDate" required type="date" />
              </label>
              <label>
                Office
                <select defaultValue={officeId ?? ""} name="officeId">
                  <option value="">All offices</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" type="submit">
              Apply filters
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Profit and loss</h2>
            <p>
              {report.journalCount.toLocaleString()} posted journal{report.journalCount === 1 ? "" : "s"} · {report.lineCount.toLocaleString()} line
              {report.lineCount === 1 ? "" : "s"}
            </p>
          </div>
          <span className={`status ${report.netIncomeMinor >= 0n ? "up-to-date" : "review"}`}>
            {report.netIncomeMinor >= 0n ? "Net income" : "Net loss"}
          </span>
        </div>

        {!report.hasActivity ? (
          <div className="empty-state">
            <ReceiptText size={28} />
            <strong>No posted journal entries yet</strong>
            <p>The income statement will populate once posted revenue or expense journals exist in the selected period.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                <StatementSection label="Revenue" rows={report.revenue.rows.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}`, amountMinor: row.balanceMinor }))} totalMinor={report.revenue.totalMinor} />
                <StatementSection label="Expenses" rows={report.expenses.rows.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}`, amountMinor: row.balanceMinor }))} totalMinor={report.expenses.totalMinor} />
                <tr>
                  <td>
                    <strong>Net income</strong>
                  </td>
                  <td className="mono">
                    <strong>{formatMinor(report.netIncomeMinor, "UGX")}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function StatementSection({
  label,
  rows,
  totalMinor,
}: {
  label: string;
  rows: Array<{ id: string; label: string; amountMinor: bigint }>;
  totalMinor: bigint;
}) {
  return (
    <>
      <tr>
        <td colSpan={2}>
          <strong>{label}</strong>
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.id}>
          <td>{row.label}</td>
          <td className="mono">{formatMinor(row.amountMinor, "UGX")}</td>
        </tr>
      ))}
      <tr>
        <td>
          <strong>Total {label}</strong>
        </td>
        <td className="mono">
          <strong>{formatMinor(totalMinor, "UGX")}</strong>
        </td>
      </tr>
    </>
  );
}

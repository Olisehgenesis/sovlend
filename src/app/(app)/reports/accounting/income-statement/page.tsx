import { Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportDatePresetPills, parseReportDatePreset } from "@/components/report-date-presets";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  buildReportQueryString,
  currentMonthDateRange,
  formatDateInputValue,
  formatReportDate,
  getIncomeStatementReport,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveDatePreset,
  resolveOfficeFilter,
} from "@/modules/reports/domain/accounting-report";

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; officeId?: string; preset?: string }>;
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
  const [offices, pickerOptions] = await Promise.all([
    listAccountingReportOffices(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const preset = parseReportDatePreset(params.preset);
  const { startDate, endDate } = preset
    ? resolveDatePreset(new Date(), preset)
    : normalizeDateRange(
        parseDateInput(params.startDate, defaults.startDate),
        parseDateInput(params.endDate, defaults.endDate),
      );
  const officeId = resolveOfficeFilter(offices, params.officeId ?? null);
  const report = await getIncomeStatementReport(prisma, scope, { startDate, endDate, officeId });
  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const startValue = formatDateInputValue(startDate);
  const endValue = formatDateInputValue(endDate);
  const queryString = buildReportQueryString({ startDate: startValue, endDate: endValue, officeId });
  const exportHref = `/api/reports/accounting/income-statement${queryString ? `?${queryString}&` : "?"}format=csv`;
  const generalLedgerHref = (accountId: string) =>
    `/reports/accounting/general-ledger?${buildReportQueryString({
      startDate: startValue,
      endDate: endValue,
      officeId,
      accountId,
    })}`;
  const netLabel = report.netIncomeMinor >= 0n ? "Net income" : "Net loss";

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Income Statement" }]} />
      <header className="directory-header">
        <div>
          <h1>Income Statement</h1>
          <p>
            {formatReportDate(report.startDate)} – {formatReportDate(report.endDate)} · {activeOfficeName}
          </p>
        </div>
        <ReportPicker current="/reports/accounting/income-statement" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      <section className="loan-summary-metrics coa-summary-metrics" aria-label="Income statement totals" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <article>
          <span>Revenue</span>
          <strong>{formatMinor(report.revenue.totalMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Expenses</span>
          <strong>{formatMinor(report.expenses.totalMinor, "UGX")}</strong>
        </article>
        <article>
          <span>{netLabel}</span>
          <strong>{formatMinor(report.netIncomeMinor, "UGX")}</strong>
        </article>
      </section>

      <section className="panel report-toolbar">
        <ReportDatePresetPills
          active={preset}
          pathname="/reports/accounting/income-statement"
          query={{ officeId }}
        />
        <form className="report-toolbar-form" method="GET">
          <label>
            From
            <input defaultValue={startValue} name="startDate" required type="date" />
          </label>
          <label>
            To
            <input defaultValue={endValue} name="endDate" required type="date" />
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
          <button className="primary" type="submit">
            Apply
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Profit and loss</h2>
            <p>
              {report.journalCount.toLocaleString()} journals · {report.lineCount.toLocaleString()} lines · {netLabel}
            </p>
          </div>
        </div>

        {!report.hasActivity ? (
          <p className="coa-section-empty">No posted revenue or expense journals in this period.</p>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                <StatementSection
                  id="revenue-section"
                  label="Revenue"
                  rows={report.revenue.rows.map((row) => ({
                    id: row.id,
                    label: `${row.code} · ${row.name}`,
                    amountMinor: row.balanceMinor,
                    href: generalLedgerHref(row.id),
                  }))}
                  totalMinor={report.revenue.totalMinor}
                />
                <StatementSection
                  id="expenses-section"
                  label="Expenses"
                  rows={report.expenses.rows.map((row) => ({
                    id: row.id,
                    label: `${row.code} · ${row.name}`,
                    amountMinor: row.balanceMinor,
                    href: generalLedgerHref(row.id),
                  }))}
                  totalMinor={report.expenses.totalMinor}
                />
                <tr>
                  <td>
                    <strong>{netLabel}</strong>
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
  id,
  label,
  rows,
  totalMinor,
}: {
  id: string;
  label: string;
  rows: Array<{ id: string; label: string; amountMinor: bigint; href: string }>;
  totalMinor: bigint;
}) {
  return (
    <>
      <tr id={id}>
        <td colSpan={2}>
          <strong>{label}</strong>
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.id}>
          <td>
            {row.label}
            <Link className="row-link" href={row.href} aria-label={`Open ${row.label} in the general ledger`} />
          </td>
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

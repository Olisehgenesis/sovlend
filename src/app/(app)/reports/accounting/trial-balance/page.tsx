import { Download, Scale } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { ReportZeroToggle } from "@/components/report-zero-toggle";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  accountingAccountTypeSections,
  buildReportQueryString,
  currentMonthDateRange,
  formatDateInputValue,
  formatReportDate,
  getTrialBalanceReport,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveDatePreset,
  resolveOfficeFilter,
  summarizeBalance,
  type ReportDatePreset,
  type TrialBalanceRow,
} from "@/modules/reports/domain/accounting-report";

const DATE_PRESETS: { value: ReportDatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; officeId?: string; preset?: string; showZero?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportTrialBalance,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const defaults = currentMonthDateRange();
  const [offices, pickerOptions] = await Promise.all([
    listAccountingReportOffices(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const preset = params.preset === "today" || params.preset === "week" || params.preset === "month" ? params.preset : null;
  const { startDate, endDate } = preset
    ? resolveDatePreset(new Date(), preset)
    : normalizeDateRange(
        parseDateInput(params.startDate, defaults.startDate),
        parseDateInput(params.endDate, defaults.endDate),
      );
  const officeId = resolveOfficeFilter(offices, params.officeId ?? null);
  const showZero = params.showZero === "1";
  const report = await getTrialBalanceReport(prisma, scope, { startDate, endDate, officeId });
  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const queryString = buildReportQueryString({
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
    officeId,
    showZero: showZero ? "1" : undefined,
  });
  const apiHref = `/api/reports/accounting/trial-balance${queryString ? `?${queryString}` : ""}`;
  const exportHref = `${apiHref}${queryString ? "&" : "?"}format=csv`;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Trial Balance" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting statements</p>
          <h1>Trial Balance</h1>
          <p>
            Ledger debits and credits from {formatReportDate(report.startDate)} to {formatReportDate(report.endDate)} · {activeOfficeName}
          </p>
        </div>
        <ReportPicker current="/reports/accounting/trial-balance" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <a className="secondary-action" href={apiHref}>
            API JSON
          </a>
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
        </div>
      </header>

      <section className="panel form-panel">
        <div className="quick-filters">
          <span className="quick-filters-label">Quick range</span>
          <div className="quick-filters-pills">
            {DATE_PRESETS.map((item) => (
              <Link
                className={`pill-link ${preset === item.value ? "active" : ""}`}
                href={`/reports/accounting/trial-balance?${buildReportQueryString({ preset: item.value, officeId, showZero: showZero ? "1" : undefined })}`}
                key={item.value}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <span className="quick-filters-label">Office</span>
          <div className="quick-filters-pills">
            <Link
              className={`pill-link ${!officeId ? "active" : ""}`}
              href={`/reports/accounting/trial-balance?${buildReportQueryString({
                startDate: formatDateInputValue(startDate),
                endDate: formatDateInputValue(endDate),
                showZero: showZero ? "1" : undefined,
              })}`}
            >
              All offices
            </Link>
            {offices.map((office) => (
              <Link
                className={`pill-link ${officeId === office.id ? "active" : ""}`}
                href={`/reports/accounting/trial-balance?${buildReportQueryString({
                  startDate: formatDateInputValue(startDate),
                  endDate: formatDateInputValue(endDate),
                  officeId: office.id,
                  showZero: showZero ? "1" : undefined,
                })}`}
                key={office.id}
              >
                {office.name}
              </Link>
            ))}
          </div>
        </div>
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
            <ReportZeroToggle defaultChecked={showZero} label="Show zero-balance accounts" name="showZero" />
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
            <h2>Trial balance</h2>
            <p>
              {report.rows.length.toLocaleString()} account{report.rows.length === 1 ? "" : "s"} · {report.journalCount.toLocaleString()} posted journal
              {report.journalCount === 1 ? "" : "s"}
            </p>
          </div>
          <span className={`status ${report.differenceMinor === 0n ? "up-to-date" : "review"}`}>
            {report.differenceMinor === 0n ? "Balanced" : "Out of balance"}
          </span>
        </div>

        {!report.hasActivity ? (
          <div className="empty-state">
            <Scale size={28} />
            <strong>No posted journal entries yet</strong>
            <p>The trial balance will populate once posted journals exist in the selected period and office scope.</p>
          </div>
        ) : (
          <div className="statement-body">
            <div className="statement-columns-heading">
              <span className="statement-columns-heading-account">Account</span>
              <span className="statement-columns-heading-amount">Debit</span>
              <span className="statement-columns-heading-amount">Credit</span>
            </div>
            {accountingAccountTypeSections.map((section) => {
              const allRows = report.rows.filter((row) => row.type === section.type);
              const rows = showZero ? allRows : allRows.filter((row) => row.balanceMinor !== 0n);
              if (allRows.length === 0) return null;
              const sectionTotal = allRows.reduce(
                (sum, row) => sum + summarizeBalance(row.type, row.balanceMinor).absoluteMinor,
                0n,
              );

              return (
                <details className="statement-section" key={section.type} open>
                  <summary className="statement-section-heading">
                    {section.label}
                    <span className="statement-section-count">{rows.length.toLocaleString()}</span>
                  </summary>
                  {rows.length === 0 ? (
                    <p className="statement-empty-note">All {section.label.toLowerCase()} accounts are zero-balance and hidden.</p>
                  ) : (
                    <div className="statement-rows">
                      {rows.map((row) => (
                        <StatementRow
                          endDate={endDate}
                          key={row.id}
                          officeId={officeId}
                          row={row}
                          startDate={startDate}
                        />
                      ))}
                    </div>
                  )}
                  <div className="statement-subtotal">
                    <span>Total {section.label.toLowerCase()}</span>
                    <span className="mono">{formatMinor(sectionTotal, "UGX")}</span>
                  </div>
                </details>
              );
            })}

            <div className="statement-section statement-grand-total">
              <div className="statement-rows">
                <div className="statement-row">
                  <span>Total debits</span>
                  <span className="mono">{formatMinor(report.totalDebitsMinor, "UGX")}</span>
                </div>
                <div className="statement-row">
                  <span>Total credits</span>
                  <span className="mono">{formatMinor(report.totalCreditsMinor, "UGX")}</span>
                </div>
                <div className="statement-row">
                  <span>
                    <strong>Difference</strong>
                  </span>
                  <span className="mono">
                    <strong>{formatMinor(report.differenceMinor, "UGX")}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function StatementRow({
  row,
  officeId,
  startDate,
  endDate,
}: {
  row: TrialBalanceRow;
  officeId: string | null;
  startDate: Date;
  endDate: Date;
}) {
  const balance = summarizeBalance(row.type, row.balanceMinor);
  const href = `/reports/accounting/general-ledger?${buildReportQueryString({
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
    officeId,
    accountId: row.id,
  })}`;
  const amountFormatted = balance.balanceSide === "ZERO" ? null : formatMinor(balance.absoluteMinor, "UGX");

  return (
    <Link className="statement-row statement-row-link" href={href}>
      <span className="statement-row-code mono">{row.code}</span>
      <span className="statement-row-account">{row.name}</span>
      <span className="mono statement-row-amount">{balance.balanceSide === "DEBIT" ? amountFormatted : null}</span>
      <span className="mono statement-row-amount">{balance.balanceSide === "CREDIT" ? amountFormatted : null}</span>
    </Link>
  );
}

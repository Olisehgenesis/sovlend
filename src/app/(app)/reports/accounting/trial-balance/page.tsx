import { Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportDatePresetPills, parseReportDatePreset } from "@/components/report-date-presets";
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
  type TrialBalanceRow,
} from "@/modules/reports/domain/accounting-report";

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
  const preset = parseReportDatePreset(params.preset);
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
  const startValue = formatDateInputValue(startDate);
  const endValue = formatDateInputValue(endDate);
  const queryString = buildReportQueryString({
    startDate: startValue,
    endDate: endValue,
    officeId,
    showZero: showZero ? "1" : undefined,
  });
  const exportHref = `/api/reports/accounting/trial-balance${queryString ? `?${queryString}&` : "?"}format=csv`;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Trial Balance" }]} />
      <header className="directory-header">
        <div>
          <h1>Trial Balance</h1>
          <p>
            {formatReportDate(report.startDate)} – {formatReportDate(report.endDate)} · {activeOfficeName}
          </p>
        </div>
        <ReportPicker current="/reports/accounting/trial-balance" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      <section className="loan-summary-metrics coa-summary-metrics" aria-label="Trial balance totals" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <article>
          <span>Total debits</span>
          <strong>{formatMinor(report.totalDebitsMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Total credits</span>
          <strong>{formatMinor(report.totalCreditsMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Difference</span>
          <strong>{formatMinor(report.differenceMinor, "UGX")}</strong>
        </article>
      </section>

      <section className="panel report-toolbar">
        <ReportDatePresetPills
          active={preset}
          pathname="/reports/accounting/trial-balance"
          query={{ officeId, showZero: showZero ? "1" : undefined }}
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
          <ReportZeroToggle defaultChecked={showZero} label="Show zero balances" name="showZero" />
          <button className="primary" type="submit">
            Apply
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Trial balance</h2>
            <p>
              {report.rows.length.toLocaleString()} accounts · {report.journalCount.toLocaleString()} journals
              {report.differenceMinor === 0n ? " · Balanced" : " · Out of balance"}
            </p>
          </div>
        </div>

        {!report.hasActivity ? (
          <p className="coa-section-empty">No posted journals in this period and office.</p>
        ) : (
          <div className="statement-body">
            <div className="statement-columns-heading">
              <span>Code</span>
              <span>Account</span>
              <span className="statement-columns-heading-amount">Debit</span>
              <span className="statement-columns-heading-amount">Credit</span>
            </div>
            {accountingAccountTypeSections.map((section) => {
              const allRows = report.rows.filter((row) => row.type === section.type);
              const rows = showZero ? allRows : allRows.filter((row) => row.balanceMinor !== 0n);
              if (allRows.length === 0) return null;
              const sectionDebitMinor = allRows.reduce((sum, row) => {
                const balance = summarizeBalance(row.type, row.balanceMinor);
                return balance.balanceSide === "DEBIT" ? sum + balance.absoluteMinor : sum;
              }, 0n);
              const sectionCreditMinor = allRows.reduce((sum, row) => {
                const balance = summarizeBalance(row.type, row.balanceMinor);
                return balance.balanceSide === "CREDIT" ? sum + balance.absoluteMinor : sum;
              }, 0n);

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
                    <span />
                    <span>Total {section.label.toLowerCase()}</span>
                    <span className="mono">{sectionDebitMinor === 0n ? null : formatMinor(sectionDebitMinor, "UGX")}</span>
                    <span className="mono">{sectionCreditMinor === 0n ? null : formatMinor(sectionCreditMinor, "UGX")}</span>
                  </div>
                </details>
              );
            })}

            <div className="statement-section statement-grand-total">
              <div className="statement-rows">
                <div className="statement-row">
                  <span />
                  <span>Total debits</span>
                  <span className="mono">{formatMinor(report.totalDebitsMinor, "UGX")}</span>
                  <span />
                </div>
                <div className="statement-row">
                  <span />
                  <span>Total credits</span>
                  <span />
                  <span className="mono">{formatMinor(report.totalCreditsMinor, "UGX")}</span>
                </div>
                <div className="statement-row">
                  <span />
                  <span>
                    <strong>Difference</strong>
                  </span>
                  <span className="mono">
                    <strong>{formatMinor(report.differenceMinor, "UGX")}</strong>
                  </span>
                  <span />
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

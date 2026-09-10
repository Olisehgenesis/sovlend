import { Download, Scale } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
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
  formatDateInputValue,
  formatReportDate,
  getBalanceSheetReport,
  listAccountingReportOffices,
  OPENING_BALANCE_START_DATE,
  parseDateInput,
  resolveOfficeFilter,
} from "@/modules/reports/domain/accounting-report";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ endDate?: string; officeId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportBalanceSheet,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const [offices, pickerOptions] = await Promise.all([
    listAccountingReportOffices(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const endDate = parseDateInput(params.endDate, new Date());
  const officeId = resolveOfficeFilter(offices, params.officeId ?? null);
  const report = await getBalanceSheetReport(prisma, scope, { endDate, officeId });
  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const queryString = buildReportQueryString({
    endDate: formatDateInputValue(endDate),
    officeId,
  });
  const apiHref = `/api/reports/accounting/balance-sheet${queryString ? `?${queryString}` : ""}`;
  const exportHref = `${apiHref}${queryString ? "&" : "?"}format=csv`;
  // Balance sheet balances are cumulative since inception, so drill-down links use the same
  // full history (opening balance date through the "as of" date) rather than the current month.
  const historyRangeQuery = {
    startDate: formatDateInputValue(OPENING_BALANCE_START_DATE),
    endDate: formatDateInputValue(endDate),
    officeId,
  };
  const generalLedgerHref = (accountId: string) =>
    `/reports/accounting/general-ledger?${buildReportQueryString({ ...historyRangeQuery, accountId })}`;
  const incomeStatementHref = `/reports/accounting/income-statement?${buildReportQueryString(historyRangeQuery)}`;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Balance Sheet" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting statements</p>
          <h1>Balance Sheet</h1>
          <p>
            Statement of financial position as of {formatReportDate(report.asOfDate)} · {activeOfficeName}
          </p>
        </div>
        <ReportPicker current="/reports/accounting/balance-sheet" options={pickerOptions} />
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
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Filters</legend>
            <div className="form-row">
              <label>
                As of date
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
            <h2>Statement of financial position</h2>
            <p>
              {report.journalCount.toLocaleString()} posted journal{report.journalCount === 1 ? "" : "s"} · {report.lineCount.toLocaleString()} line
              {report.lineCount === 1 ? "" : "s"}
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
            <p>The balance sheet will populate once posted accounting journals exist for the selected date and office scope.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {report.sections.map((section) => {
                  const isEquity = section.type === "EQUITY";
                  return (
                    <SectionRows
                      key={section.label}
                      label={section.label}
                      netIncomeRow={
                        isEquity && report.netIncomeToDateMinor !== 0n
                          ? { amountMinor: report.netIncomeToDateMinor, href: incomeStatementHref }
                          : null
                      }
                      rows={section.rows.map((row) => ({
                        id: row.id,
                        label: `${row.code} · ${row.name}`,
                        amountMinor: row.balanceMinor,
                        href: generalLedgerHref(row.id),
                      }))}
                      totalMinor={isEquity ? section.totalMinor + report.netIncomeToDateMinor : section.totalMinor}
                    />
                  );
                })}
                <tr>
                  <td>
                    <strong>Assets</strong>
                  </td>
                  <td className="mono">
                    <strong>{formatMinor(report.assetsTotalMinor, "UGX")}</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Liabilities + Equity</strong>
                  </td>
                  <td className="mono">
                    <strong>{formatMinor(report.liabilitiesAndEquityTotalMinor, "UGX")}</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Difference</strong>
                  </td>
                  <td className="mono">
                    <strong>{formatMinor(report.differenceMinor, "UGX")}</strong>
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

function SectionRows({
  label,
  rows,
  netIncomeRow,
  totalMinor,
}: {
  label: string;
  rows: Array<{ id: string; label: string; amountMinor: bigint; href: string }>;
  netIncomeRow: { amountMinor: bigint; href: string } | null;
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
          <td>
            {row.label}
            <Link className="row-link" href={row.href} aria-label={`Open ${row.label} in the general ledger`} />
          </td>
          <td className="mono">{formatMinor(row.amountMinor, "UGX")}</td>
        </tr>
      ))}
      {netIncomeRow ? (
        <tr>
          <td>
            Net income (retained earnings to date)
            <Link className="row-link" href={netIncomeRow.href} aria-label="Open the income statement" />
          </td>
          <td className="mono">{formatMinor(netIncomeRow.amountMinor, "UGX")}</td>
        </tr>
      ) : null}
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

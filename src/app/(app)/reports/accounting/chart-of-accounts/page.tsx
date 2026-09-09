import { BookOpenText, Download } from "lucide-react";
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
  accountingAccountTypeSections,
  accountTypeLabel,
  buildReportQueryString,
  currentMonthDateRange,
  formatDateInputValue,
  formatReportDate,
  getChartOfAccountsReport,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveAccountTypeFilter,
  resolveOfficeFilter,
  sideLabel,
  summarizeBalance,
  todayDate,
  type ChartOfAccountsRow,
} from "@/modules/reports/domain/accounting-report";

export default async function ChartOfAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    asOfDate?: string;
    startDate?: string;
    endDate?: string;
    officeId?: string;
    accountType?: string;
    accountId?: string;
  }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportGeneralLedger,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const defaults = currentMonthDateRange();
  const [offices, pickerOptions] = await Promise.all([
    listAccountingReportOffices(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const officeId = resolveOfficeFilter(offices, params.officeId ?? null);
  const accountType = resolveAccountTypeFilter(params.accountType ?? null);
  const { startDate, endDate } = normalizeDateRange(
    parseDateInput(params.startDate, defaults.startDate),
    parseDateInput(params.endDate, defaults.endDate),
  );
  const balanceDate = parseDateInput(params.asOfDate, todayDate());
  const report = await getChartOfAccountsReport(prisma, scope, {
    balanceDate,
    activityStartDate: startDate,
    activityEndDate: endDate,
    officeId,
    accountType,
    accountId: params.accountId ?? null,
  });

  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const queryString = buildReportQueryString({
    asOfDate: formatDateInputValue(report.balanceDate),
    startDate: formatDateInputValue(report.activityStartDate),
    endDate: formatDateInputValue(report.activityEndDate),
    officeId,
    accountType: report.accountType,
    accountId: report.generalLedger.account?.id ?? null,
  });
  const apiHref = `/api/reports/accounting/chart-of-accounts${queryString ? `?${queryString}` : ""}`;
  const exportHref = `${apiHref}${queryString ? "&" : "?"}format=csv`;
  const generalLedgerHref = report.generalLedger.account
    ? `/reports/accounting/general-ledger?${buildReportQueryString({
        startDate: formatDateInputValue(report.activityStartDate),
        endDate: formatDateInputValue(report.activityEndDate),
        officeId,
        accountId: report.generalLedger.account.id,
      })}`
    : "/reports/accounting/general-ledger";

  const selectedBalance = report.selectedAccountRow
    ? summarizeBalance(report.selectedAccountRow.type, report.selectedAccountRow.balanceMinor)
    : null;
  const activityClosingBalance = report.generalLedger.account
    ? summarizeBalance(report.generalLedger.account.type, report.generalLedger.closingBalanceMinor)
    : null;
  const hasSelectableAccounts = report.sections.some((section) => section.rows.length > 0);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Chart of Accounts" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting statements</p>
          <h1>Chart of Accounts</h1>
          <p>
            Live ledger balances as of {formatReportDate(report.balanceDate)} · {activeOfficeName}
          </p>
        </div>
        <ReportPicker current="/reports/accounting/chart-of-accounts" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <a className="secondary-action" href={apiHref}>
            API JSON
          </a>
          {session.user.role === "admin" ? (
            <Link className="secondary-action" href="/backoffice/accounting">
              Create account
            </Link>
          ) : null}
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
        </div>
      </header>

      <section className="metrics" style={{ marginTop: 18 }}>
        <SummaryCard
          amountMinor={report.totalAssetsMinor}
          balanceDate={report.balanceDate}
          href={`/reports/accounting/chart-of-accounts?${buildReportQueryString({
            asOfDate: formatDateInputValue(report.balanceDate),
            startDate: formatDateInputValue(report.activityStartDate),
            endDate: formatDateInputValue(report.activityEndDate),
            officeId,
            accountType: "ASSET",
          })}`}
          label="Assets"
          type="ASSET"
        />
        <SummaryCard
          amountMinor={report.totalLiabilitiesMinor}
          balanceDate={report.balanceDate}
          href={`/reports/accounting/chart-of-accounts?${buildReportQueryString({
            asOfDate: formatDateInputValue(report.balanceDate),
            startDate: formatDateInputValue(report.activityStartDate),
            endDate: formatDateInputValue(report.activityEndDate),
            officeId,
            accountType: "LIABILITY",
          })}`}
          label="Liabilities"
          type="LIABILITY"
        />
        <SummaryCard
          amountMinor={report.totalEquityMinor}
          balanceDate={report.balanceDate}
          href={`/reports/accounting/chart-of-accounts?${buildReportQueryString({
            asOfDate: formatDateInputValue(report.balanceDate),
            startDate: formatDateInputValue(report.activityStartDate),
            endDate: formatDateInputValue(report.activityEndDate),
            officeId,
            accountType: "EQUITY",
          })}`}
          label="Equity"
          type="EQUITY"
        />
        <SummaryCard
          amountMinor={report.totalRevenueMinor}
          balanceDate={report.balanceDate}
          href={`/reports/accounting/chart-of-accounts?${buildReportQueryString({
            asOfDate: formatDateInputValue(report.balanceDate),
            startDate: formatDateInputValue(report.activityStartDate),
            endDate: formatDateInputValue(report.activityEndDate),
            officeId,
            accountType: "REVENUE",
          })}`}
          label="Revenue"
          type="REVENUE"
        />
        <SummaryCard
          amountMinor={report.totalExpensesMinor}
          balanceDate={report.balanceDate}
          href={`/reports/accounting/chart-of-accounts?${buildReportQueryString({
            asOfDate: formatDateInputValue(report.balanceDate),
            startDate: formatDateInputValue(report.activityStartDate),
            endDate: formatDateInputValue(report.activityEndDate),
            officeId,
            accountType: "EXPENSE",
          })}`}
          label="Expenses"
          type="EXPENSE"
        />
      </section>

      <section className="panel form-panel">
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Filters</legend>
            <div className="form-row three">
              <label>
                Balance as of
                <input defaultValue={formatDateInputValue(report.balanceDate)} name="asOfDate" required type="date" />
              </label>
              <label>
                Activity start date
                <input defaultValue={formatDateInputValue(report.activityStartDate)} name="startDate" required type="date" />
              </label>
              <label>
                Activity end date
                <input defaultValue={formatDateInputValue(report.activityEndDate)} name="endDate" required type="date" />
              </label>
            </div>
            <div className="form-row three">
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
              <label>
                Account type
                <select defaultValue={report.accountType ?? ""} name="accountType">
                  <option value="">All account types</option>
                  {accountingAccountTypeSections.map((section) => (
                    <option key={section.type} value={section.type}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Account
                <select defaultValue={report.generalLedger.account?.id ?? ""} name="accountId">
                  {!hasSelectableAccounts ? <option value="">No accounts available</option> : null}
                  {report.sections.flatMap((section) =>
                    section.rows.length > 0 ? (
                      <optgroup key={section.type} label={section.label}>
                        {section.rows.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.code} · {row.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : [],
                  )}
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

      <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
        {report.sections.map((section) => (
          <section className="panel" key={section.type}>
            <div className="panel-heading">
              <div>
                <h2>{section.label}</h2>
                <p>
                  {section.rows.length.toLocaleString()} account{section.rows.length === 1 ? "" : "s"} · {section.nonZeroCount.toLocaleString()} with
                  balance
                </p>
              </div>
              <span className="status up-to-date">
                {formatBalance(section.type, section.totalMinor, "UGX")}
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11, padding: "0 18px 14px" }}>
              Current balances use posted journal lines through {formatReportDate(report.balanceDate)}.
            </div>
            {section.rows.length === 0 ? (
              <div className="empty-state" style={{ minHeight: 160 }}>
                <BookOpenText size={24} />
                <strong>No {section.label.toLowerCase()} accounts</strong>
                <p>Create or activate detail accounts of this type to populate this section.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="clickable-rows">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Lifetime debits</th>
                      <th>Lifetime credits</th>
                      <th>Current balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => {
                      const rowHref = `/reports/accounting/chart-of-accounts?${buildReportQueryString({
                        asOfDate: formatDateInputValue(report.balanceDate),
                        startDate: formatDateInputValue(report.activityStartDate),
                        endDate: formatDateInputValue(report.activityEndDate),
                        officeId,
                        accountType: report.accountType,
                        accountId: row.id,
                      })}`;
                      const isSelected = row.id === report.selectedAccountRow?.id;

                      return (
                        <tr key={row.id} style={isSelected ? { background: "#f5f8f4" } : undefined}>
                          <td>
                            <strong>
                              {row.code} · {row.name}
                            </strong>
                            <small>{accountTypeLabel(row.type)} account</small>
                            <Link aria-label={`Open ${row.name}`} className="row-link" href={rowHref} />
                          </td>
                          <td className="mono">{formatMinor(row.debitTotalMinor, row.currencyCode)}</td>
                          <td className="mono">{formatMinor(row.creditTotalMinor, row.currencyCode)}</td>
                          <td className="mono">
                            <strong>{formatBalance(row.type, row.balanceMinor, row.currencyCode)}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {report.generalLedger.account
                  ? `${report.generalLedger.account.code} · ${report.generalLedger.account.name}`
                  : "Account activity"}
              </h2>
              <p>
                Recent journal movement from {formatReportDate(report.activityStartDate)} to {formatReportDate(report.activityEndDate)}
              </p>
            </div>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              {selectedBalance && report.selectedAccountRow ? (
                <span className="status up-to-date">
                  Current {formatMinor(selectedBalance.absoluteMinor, report.selectedAccountRow.currencyCode)} {sideLabel(selectedBalance.balanceSide)}
                </span>
              ) : null}
              <Link className="secondary-action" href={generalLedgerHref}>
                Open General Ledger
              </Link>
            </div>
          </div>

          {!report.generalLedger.account ? (
            <div className="empty-state" style={{ minHeight: 160 }}>
              <BookOpenText size={28} />
              <strong>No ledger accounts available</strong>
              <p>Configure detail GL accounts before browsing ledger balances.</p>
            </div>
          ) : !report.generalLedger.hasActivity ? (
            <div className="empty-state" style={{ minHeight: 160 }}>
              <BookOpenText size={28} />
              <strong>No posted entries in the selected activity window</strong>
              <p>
                This account currently stands at{" "}
                {selectedBalance
                  ? formatMinor(selectedBalance.absoluteMinor, report.generalLedger.account.currencyCode)
                  : formatMinor(0n, report.generalLedger.account.currencyCode)}
                {selectedBalance ? ` ${sideLabel(selectedBalance.balanceSide)}` : ""}, but there were no movements in this period.
              </p>
            </div>
          ) : (
            <>
              <div style={{ color: "var(--muted)", display: "flex", flexWrap: "wrap", fontSize: 11, gap: 14, padding: "14px 18px" }}>
                <span>
                  {report.generalLedger.journalCount.toLocaleString()} posted journal{report.generalLedger.journalCount === 1 ? "" : "s"}
                </span>
                <span>
                  {report.generalLedger.lineCount.toLocaleString()} ledger line{report.generalLedger.lineCount === 1 ? "" : "s"}
                </span>
                {activityClosingBalance && report.generalLedger.account ? (
                  <span>
                    Activity-window closing {formatMinor(activityClosingBalance.absoluteMinor, report.generalLedger.account.currencyCode)}{" "}
                    {sideLabel(activityClosingBalance.balanceSide)}
                  </span>
                ) : null}
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Journal</th>
                      <th>Office</th>
                      <th>Memo</th>
                      <th>Debit</th>
                      <th>Credit</th>
                      <th>Running balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.generalLedger.entries.map((entry) => {
                      const running = summarizeBalance(report.generalLedger.account!.type, entry.runningBalanceMinor);
                      return (
                        <tr key={entry.id}>
                          <td>{formatReportDate(entry.businessDate)}</td>
                          <td>
                            <strong>{entry.referenceType.replaceAll("_", " ")}</strong>
                            <small>{entry.referenceId ?? entry.journalId}</small>
                          </td>
                          <td>{entry.officeName}</td>
                          <td>{entry.memo ?? entry.narration}</td>
                          <td className="mono">
                            {entry.direction === "DEBIT" ? formatMinor(entry.amountMinor, report.generalLedger.account!.currencyCode) : "—"}
                          </td>
                          <td className="mono">
                            {entry.direction === "CREDIT" ? formatMinor(entry.amountMinor, report.generalLedger.account!.currencyCode) : "—"}
                          </td>
                          <td className="mono">
                            {formatMinor(running.absoluteMinor, report.generalLedger.account!.currencyCode)} {sideLabel(running.balanceSide)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td>
                        <strong>Totals</strong>
                      </td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td className="mono">
                        <strong>{formatMinor(report.generalLedger.debitTotalMinor, report.generalLedger.account.currencyCode)}</strong>
                      </td>
                      <td className="mono">
                        <strong>{formatMinor(report.generalLedger.creditTotalMinor, report.generalLedger.account.currencyCode)}</strong>
                      </td>
                      <td className="mono">
                        <strong>
                          {activityClosingBalance
                            ? `${formatMinor(activityClosingBalance.absoluteMinor, report.generalLedger.account.currencyCode)} ${sideLabel(activityClosingBalance.balanceSide)}`
                            : "—"}
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  amountMinor,
  balanceDate,
  href,
  label,
  type,
}: {
  amountMinor: bigint;
  balanceDate: Date;
  href: string;
  label: string;
  type: ChartOfAccountsRow["type"];
}) {
  const balance = summarizeBalance(type, amountMinor);

  return (
    <Link className="metric-card" href={href}>
      <article>
        <span>{label}</span>
        <strong>{formatMinor(balance.absoluteMinor, "UGX")}</strong>
        <small>
          As of {formatReportDate(balanceDate)} · {sideLabel(balance.balanceSide)}
        </small>
      </article>
    </Link>
  );
}

function formatBalance(type: ChartOfAccountsRow["type"], amountMinor: bigint, currencyCode: string) {
  const balance = summarizeBalance(type, amountMinor);
  return `${formatMinor(balance.absoluteMinor, currencyCode)} ${sideLabel(balance.balanceSide)}`;
}

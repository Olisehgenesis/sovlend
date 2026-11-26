import { Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { parseReportDatePreset, ReportDatePresetPills } from "@/components/report-date-presets";
import { ReportPicker } from "@/components/report-picker";
import { ReportZeroToggle } from "@/components/report-zero-toggle";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { journalLineDescription } from "@/modules/ledger/domain/journal";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  accountingAccountTypeSections,
  buildReportQueryString,
  currentMonthDateRange,
  formatDateInputValue,
  formatReportDate,
  getChartOfAccountsReport,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveAccountTypeFilter,
  resolveDatePreset,
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
    preset?: string;
    showZero?: string;
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
  const showZero = params.showZero === "1";
  const preset = parseReportDatePreset(params.preset);
  const activityRange = preset
    ? resolveDatePreset(new Date(), preset)
    : normalizeDateRange(
        parseDateInput(params.startDate, defaults.startDate),
        parseDateInput(params.endDate, defaults.endDate),
      );
  const balanceDate = parseDateInput(params.asOfDate, preset ? activityRange.endDate : todayDate());
  const report = await getChartOfAccountsReport(prisma, scope, {
    balanceDate,
    activityStartDate: activityRange.startDate,
    activityEndDate: activityRange.endDate,
    officeId,
    accountType,
    accountId: params.accountId ?? null,
  });

  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const asOfValue = formatDateInputValue(report.balanceDate);
  const startValue = formatDateInputValue(report.activityStartDate);
  const endValue = formatDateInputValue(report.activityEndDate);
  const filterState = {
    asOfDate: asOfValue,
    startDate: startValue,
    endDate: endValue,
    officeId,
    accountType: report.accountType,
    accountId: report.selectedAccountRow?.id ?? null,
    showZero: showZero ? "1" : undefined,
  };
  const queryString = buildReportQueryString(filterState);
  const exportHref = `/api/reports/accounting/chart-of-accounts${queryString ? `?${queryString}&` : "?"}format=csv`;
  const generalLedgerHref = report.generalLedger.account
    ? `/reports/accounting/general-ledger?${buildReportQueryString({
        startDate: startValue,
        endDate: endValue,
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

  const summaryCards = [
    { label: "Assets", amountMinor: report.totalAssetsMinor, type: "ASSET" as const },
    { label: "Liabilities", amountMinor: report.totalLiabilitiesMinor, type: "LIABILITY" as const },
    { label: "Equity", amountMinor: report.totalEquityMinor, type: "EQUITY" as const },
    { label: "Revenue", amountMinor: report.totalRevenueMinor, type: "REVENUE" as const },
    { label: "Expenses", amountMinor: report.totalExpensesMinor, type: "EXPENSE" as const },
  ];

  const visibleSections = report.sections.map((section) => ({
    ...section,
    visibleRows: showZero ? section.rows : section.rows.filter((row) => row.balanceMinor !== 0n),
  }));

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Chart of Accounts" }]} />
      <header className="directory-header">
        <div>
          <h1>Chart of Accounts</h1>
          <p>
            Balances as of {formatReportDate(report.balanceDate)} · {activeOfficeName}
          </p>
        </div>
        <ReportPicker current="/reports/accounting/chart-of-accounts" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          {session.user.role === "admin" ? (
            <Link className="secondary-action" href="/backoffice/accounting">
              Create account
            </Link>
          ) : null}
        </div>
      </header>

      <section className="loan-summary-metrics coa-summary-metrics" aria-label="Account type totals">
        {summaryCards.map((card) => (
          <article key={card.label}>
            <span>{card.label}</span>
            <strong>{formatBalance(card.type, card.amountMinor, "UGX")}</strong>
          </article>
        ))}
      </section>

      <section className="panel report-toolbar">
        <ReportDatePresetPills
          active={preset}
          label="Activity"
          pathname="/reports/accounting/chart-of-accounts"
          query={{
            officeId,
            accountType: report.accountType,
            accountId: report.selectedAccountRow?.id,
            showZero: showZero ? "1" : undefined,
          }}
        />
        <form className="report-toolbar-form" method="GET">
          <label>
            As of
            <input defaultValue={asOfValue} name="asOfDate" required type="date" />
          </label>
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
          <label>
            Type
            <select defaultValue={report.accountType ?? ""} name="accountType">
              <option value="">All types</option>
              {accountingAccountTypeSections.map((section) => (
                <option key={section.type} value={section.type}>
                  {section.label}
                </option>
              ))}
            </select>
          </label>
          {report.selectedAccountRow ? <input name="accountId" type="hidden" value={report.selectedAccountRow.id} /> : null}
          <ReportZeroToggle defaultChecked={showZero} label="Show zero balances" name="showZero" />
          <button className="primary" type="submit">
            Apply
          </button>
        </form>
      </section>

      <section className="panel coa-ledger">
        {visibleSections.map((section) => (
          <details className="coa-section" key={section.type} open={section.visibleRows.length > 0 || Boolean(accountType)}>
            <summary className="coa-section-heading">
              <span>{section.label}</span>
              <span className="coa-section-meta">
                {section.visibleRows.length.toLocaleString()} shown
                {!showZero && section.rows.length !== section.visibleRows.length
                  ? ` · ${section.nonZeroCount.toLocaleString()} with balance`
                  : ""}
              </span>
              <strong className="mono">{formatBalance(section.type, section.totalMinor, "UGX")}</strong>
            </summary>
            {section.visibleRows.length === 0 ? (
              <p className="coa-section-empty">
                {section.rows.length === 0
                  ? `No ${section.label.toLowerCase()} accounts yet.`
                  : "All accounts in this type have a zero balance. Turn on Show zero balances to list them."}
              </p>
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
                    {section.visibleRows.map((row) => {
                      const rowHref = `/reports/accounting/chart-of-accounts?${buildReportQueryString({
                        ...filterState,
                        accountId: row.id,
                        preset,
                      })}`;
                      const isSelected = row.id === report.selectedAccountRow?.id;
                      return (
                        <tr className={isSelected ? "coa-row-selected" : undefined} key={row.id}>
                          <td>
                            <strong>
                              {row.code} · {row.name}
                            </strong>
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
          </details>
        ))}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              {report.generalLedger.account
                ? `${report.generalLedger.account.code} · ${report.generalLedger.account.name}`
                : "Account activity"}
            </h2>
            <p>
              {report.generalLedger.account
                ? `${formatReportDate(report.activityStartDate)} – ${formatReportDate(report.activityEndDate)}`
                : "Select an account in the list to see recent journal movement."}
            </p>
          </div>
          {report.generalLedger.account ? (
            <div className="coa-activity-actions">
              {selectedBalance && report.selectedAccountRow ? (
                <span className="status up-to-date">
                  {formatMinor(selectedBalance.absoluteMinor, report.selectedAccountRow.currencyCode)}{" "}
                  {sideLabel(selectedBalance.balanceSide)}
                </span>
              ) : null}
              <Link className="secondary-action" href={generalLedgerHref}>
                Open General Ledger
              </Link>
            </div>
          ) : null}
        </div>

        {!report.generalLedger.account ? (
          <p className="coa-section-empty">Click any account above to load its activity for the selected dates.</p>
        ) : !report.generalLedger.hasActivity ? (
          <p className="coa-section-empty">
            No journals from {formatReportDate(report.activityStartDate)} to {formatReportDate(report.activityEndDate)}.
            {selectedBalance
              ? ` Current balance remains ${formatMinor(selectedBalance.absoluteMinor, report.generalLedger.account.currencyCode)} ${sideLabel(selectedBalance.balanceSide)}.`
              : ""}
          </p>
        ) : (
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
                      <td>{journalLineDescription(entry.narration, entry.memo, entry.referenceType)}</td>
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
                  <td colSpan={3} />
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
        )}
      </section>
    </main>
  );
}

function formatBalance(type: ChartOfAccountsRow["type"], amountMinor: bigint, currencyCode: string) {
  const balance = summarizeBalance(type, amountMinor);
  return `${formatMinor(balance.absoluteMinor, currencyCode)} ${sideLabel(balance.balanceSide)}`;
}

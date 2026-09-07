import { BookOpenText } from "lucide-react";
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
  getGeneralLedgerReport,
  listAccountingReportAccounts,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveAccountFilter,
  resolveOfficeFilter,
  sideLabel,
  summarizeBalance,
} from "@/modules/reports/domain/accounting-report";

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; officeId?: string; accountId?: string }>;
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
  const [offices, accounts] = await Promise.all([
    listAccountingReportOffices(prisma, scope),
    listAccountingReportAccounts(prisma),
  ]);
  const { startDate, endDate } = normalizeDateRange(
    parseDateInput(params.startDate, defaults.startDate),
    parseDateInput(params.endDate, defaults.endDate),
  );
  const officeId = resolveOfficeFilter(offices, params.officeId ?? null);
  const requestedAccountId = resolveAccountFilter(accounts, params.accountId ?? null);
  const accountId = requestedAccountId ?? accounts[0]?.id ?? null;
  const report = await getGeneralLedgerReport(prisma, scope, { startDate, endDate, officeId, accountId });
  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const apiHref = `/api/reports/accounting/general-ledger?${buildReportQueryString({
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
    officeId,
    accountId: report.account?.id ?? null,
  })}`;
  const closingBalance = report.account ? summarizeBalance(report.account.type, report.closingBalanceMinor) : null;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "General Ledger" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting statements</p>
          <h1>General Ledger</h1>
          <p>
            Account movement from {formatReportDate(report.startDate)} to {formatReportDate(report.endDate)} · {activeOfficeName}
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
            <label>
              GL account
              <select defaultValue={report.account?.id ?? ""} name="accountId">
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </label>
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
            <h2>{report.account ? `${report.account.code} · ${report.account.name}` : "No account configured"}</h2>
            <p>
              {report.journalCount.toLocaleString()} posted journal{report.journalCount === 1 ? "" : "s"} · {report.lineCount.toLocaleString()} ledger line
              {report.lineCount === 1 ? "" : "s"}
            </p>
          </div>
          {closingBalance && report.account ? (
            <span className="status up-to-date">
              Closing {formatMinor(closingBalance.absoluteMinor, report.account.currencyCode)} {sideLabel(closingBalance.balanceSide)}
            </span>
          ) : null}
        </div>

        {!report.account ? (
          <div className="empty-state">
            <BookOpenText size={28} />
            <strong>No ledger accounts available</strong>
            <p>Configure detail GL accounts before opening the general ledger report.</p>
          </div>
        ) : !report.hasActivity ? (
          <div className="empty-state">
            <BookOpenText size={28} />
            <strong>No posted entries for this account</strong>
            <p>The selected ledger account has no posted movements in the chosen period and office scope.</p>
          </div>
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
                {report.entries.map((entry) => {
                  const running = report.account ? summarizeBalance(report.account.type, entry.runningBalanceMinor) : null;
                  return (
                    <tr key={entry.id}>
                      <td>{formatReportDate(entry.businessDate)}</td>
                      <td>
                        <strong>{entry.referenceType.replaceAll("_", " ")}</strong>
                        <small>{entry.referenceId ?? entry.journalId}</small>
                      </td>
                      <td>{entry.officeName}</td>
                      <td>{entry.memo ?? entry.narration}</td>
                      <td className="mono">{entry.direction === "DEBIT" ? formatMinor(entry.amountMinor, "UGX") : "—"}</td>
                      <td className="mono">{entry.direction === "CREDIT" ? formatMinor(entry.amountMinor, "UGX") : "—"}</td>
                      <td className="mono">
                        {running ? `${formatMinor(running.absoluteMinor, "UGX")} ${sideLabel(running.balanceSide)}` : "—"}
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
                    <strong>{formatMinor(report.debitTotalMinor, "UGX")}</strong>
                  </td>
                  <td className="mono">
                    <strong>{formatMinor(report.creditTotalMinor, "UGX")}</strong>
                  </td>
                  <td className="mono">
                    <strong>
                      {closingBalance && report.account
                        ? `${formatMinor(closingBalance.absoluteMinor, report.account.currencyCode)} ${sideLabel(closingBalance.balanceSide)}`
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

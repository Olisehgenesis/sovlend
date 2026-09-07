import { FileSpreadsheet } from "lucide-react";
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
  accountTypeLabel,
  buildReportQueryString,
  currentMonthDateRange,
  formatDateInputValue,
  formatReportDate,
  getJournalReconciliationReport,
  journalStatusLabel,
  listAccountingReportAccounts,
  listAccountingReportOffices,
  normalizeDateRange,
  parseDateInput,
  resolveAccountFilter,
  resolveOfficeFilter,
} from "@/modules/reports/domain/accounting-report";

export default async function JournalReconciliationPage({
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
    permissions.reportJournalReconciliation,
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
  const accountId = resolveAccountFilter(accounts, params.accountId ?? null);
  const report = await getJournalReconciliationReport(prisma, scope, { startDate, endDate, officeId, accountId });
  const activeOfficeName = offices.find((office) => office.id === officeId)?.name ?? "All offices";
  const apiHref = `/api/reports/accounting/journal-reconciliation?${buildReportQueryString({
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
    officeId,
    accountId,
  })}`;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Accounting", href: "/reports" }, { label: "Journal Reconciliation" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting statements</p>
          <h1>Journal Entries Reconciliation</h1>
          <p>
            Journal integrity review from {formatReportDate(report.startDate)} to {formatReportDate(report.endDate)} · {activeOfficeName}
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
              <select defaultValue={accountId ?? ""} name="accountId">
                <option value="">All accounts</option>
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
            <h2>Reconciliation summary</h2>
            <p>
              {report.journalCount.toLocaleString()} journal{report.journalCount === 1 ? "" : "s"} · {report.issueCount.toLocaleString()} issue
              {report.issueCount === 1 ? "" : "s"}
            </p>
          </div>
          <span className={`status ${report.issueCount === 0 ? "up-to-date" : "review"}`}>
            {report.issueCount === 0 ? "No reconciliation issues" : "Issues detected"}
          </span>
        </div>

        {!report.hasActivity ? (
          <div className="empty-state">
            <FileSpreadsheet size={28} />
            <strong>No journals found for this period</strong>
            <p>The reconciliation report will populate when journals are recorded within the selected date range.</p>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Total debits</th>
                    <th>Total credits</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">{formatMinor(report.totalDebitsMinor, "UGX")}</td>
                    <td className="mono">{formatMinor(report.totalCreditsMinor, "UGX")}</td>
                    <td className="mono">{formatMinor(report.differenceMinor, "UGX")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {report.journals.map((journal) => (
              <article className="panel" key={journal.id} style={{ marginTop: 20 }}>
                <div className="panel-heading">
                  <div>
                    <h2>{formatReportDate(journal.businessDate)} · {journal.referenceType.replaceAll("_", " ")}</h2>
                    <p>
                      {journal.officeName} · {journalStatusLabel(journal.status)} · {journal.referenceId ?? journal.id}
                    </p>
                  </div>
                  <span className={`status ${journal.isBalanced ? "up-to-date" : "review"}`}>
                    {journal.isBalanced ? "Balanced" : "Out of balance"}
                  </span>
                </div>
                <p>{journal.narration}</p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Type</th>
                        <th>Debit</th>
                        <th>Credit</th>
                        <th>Memo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journal.lines.map((line) => (
                        <tr key={line.lineId}>
                          <td>
                            <strong>{line.code}</strong>
                            <small>{line.name}</small>
                          </td>
                          <td>{accountTypeLabel(line.type)}</td>
                          <td className="mono">{line.direction === "DEBIT" ? formatMinor(line.amountMinor, "UGX") : "—"}</td>
                          <td className="mono">{line.direction === "CREDIT" ? formatMinor(line.amountMinor, "UGX") : "—"}</td>
                          <td>{line.memo ?? "—"}</td>
                        </tr>
                      ))}
                      <tr>
                        <td>
                          <strong>Journal total</strong>
                        </td>
                        <td>—</td>
                        <td className="mono">
                          <strong>{formatMinor(journal.debitTotalMinor, "UGX")}</strong>
                        </td>
                        <td className="mono">
                          <strong>{formatMinor(journal.creditTotalMinor, "UGX")}</strong>
                        </td>
                        <td className="mono">
                          <strong>{formatMinor(journal.differenceMinor, "UGX")}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </>
        )}
      </section>
    </main>
  );
}

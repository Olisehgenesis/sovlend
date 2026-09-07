import { RefreshCcw, Download } from "lucide-react";
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
import { loadRecoveriesReport, loadRiskFilterOptions, parseRiskFilters } from "@/modules/reports/domain/risk-report";

export default async function RecoveriesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; loanOfficerId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportRecoveries,
  );
  if (!allowed) redirect("/reports");

  const filters = parseRiskFilters(await searchParams);
  const [report, options, pickerOptions] = await Promise.all([
    loadRecoveriesReport(prisma, scope, filters),
    loadRiskFilterOptions(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Risk", href: "/reports" },
          { label: "Recoveries on Written-Off Loans" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Portfolio risk</p>
          <h1>Recoveries on Written-Off Loans</h1>
          <p>
            {report.totals.writtenOffLoanCount.toLocaleString()} written-off loans · {report.totals.loansWithRecoveriesCount.toLocaleString()} with recoveries · {formatMinor(report.totals.totalRecoveredMinor, "UGX")} recovered
          </p>
        </div>
        <ReportPicker current="/reports/risk/recoveries" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={`/api/reports/risk/recoveries${querySuffix(filters)}&format=csv`}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href={`/api/reports/risk/recoveries${querySuffix(filters)}`}>
            API JSON
          </Link>
          <Link className="secondary-action" href="/loans?status=WRITTEN_OFF">
            Written-off loans
          </Link>
        </div>
      </header>

      <section className="loan-summary-metrics">
        <article>
          <span>Written-off loans</span>
          <strong>{report.totals.writtenOffLoanCount.toLocaleString()}</strong>
        </article>
        <article>
          <span>Loans with recoveries</span>
          <strong>{report.totals.loansWithRecoveriesCount.toLocaleString()}</strong>
        </article>
        <article>
          <span>Total recovered</span>
          <strong>{formatMinor(report.totals.totalRecoveredMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Recovery transactions</span>
          <strong>{report.totals.recoveryTransactionCount.toLocaleString()}</strong>
        </article>
      </section>

      <section className="panel form-panel">
        <form className="entity-form" method="get">
          <div className="form-row">
            <label>
              <span>Office</span>
              <select name="officeId" defaultValue={filters.officeId ?? ""}>
                <option value="">All accessible offices</option>
                {options.offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Loan officer</span>
              <select name="loanOfficerId" defaultValue={filters.loanOfficerId ?? ""}>
                <option value="">All loan officers</option>
                {options.loanOfficers.map((loanOfficer) => (
                  <option key={loanOfficer.id} value={loanOfficer.id}>
                    {loanOfficer.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <Link className="secondary-action" href="/reports/risk/recoveries">
              Clear
            </Link>
            <button className="invest-button" type="submit">
              Apply filters
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Write-off date assumption</h2>
            <p>{report.assumptions.writeOffDateSource}</p>
          </div>
        </div>
        {report.periods.length === 0 ? (
          <div className="empty-state">
            <RefreshCcw size={28} />
            <strong>No recovery periods found</strong>
            <p>There are no written-off recoveries in the current scope.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Loans</th>
                  <th>Recoveries</th>
                  <th>Recovered amount</th>
                </tr>
              </thead>
              <tbody>
                {report.periods.map((period) => (
                  <tr key={period.periodKey}>
                    <td>
                      <strong>{period.periodLabel}</strong>
                    </td>
                    <td>{period.loanCount.toLocaleString()}</td>
                    <td>{period.recoveryCount.toLocaleString()}</td>
                    <td>{formatMinor(period.recoveredMinor, "UGX")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recovered written-off loans</h2>
            <p>Repayment-type transactions dated after the write-off event.</p>
          </div>
          <RefreshCcw size={19} />
        </div>
        {report.loans.length === 0 ? (
          <div className="empty-state">
            <RefreshCcw size={28} />
            <strong>No recoveries found</strong>
            <p>There are no repayment-type transactions after write-off in the current scope.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>Product</th>
                  <th>Office</th>
                  <th>Officer</th>
                  <th>Write-off date</th>
                  <th>Source</th>
                  <th>Written off</th>
                  <th>Recovered</th>
                </tr>
              </thead>
              <tbody>
                {report.loans.map((loan) => (
                  <tr key={loan.id}>
                    <td>
                      <strong>{loan.borrowerName}</strong>
                      <small className="mono">{loan.accountNumber}</small>
                      <Link className="row-link" href={`/loans/${loan.id}`} aria-label={`Open ${loan.accountNumber}`} />
                    </td>
                    <td>{loan.productName}</td>
                    <td>{loan.officeName}</td>
                    <td>{loan.loanOfficerName}</td>
                    <td>{formatDate(loan.writeOffDate)}</td>
                    <td>{loan.writeOffDateSource}</td>
                    <td>{formatMinor(loan.writeOffAmountMinor, loan.currencyCode)}</td>
                    <td>
                      <strong>{formatMinor(loan.recoveredAmountMinor, loan.currencyCode)}</strong>
                      <small>
                        {loan.recoveryCount} tx · {loan.latestRecoveryOn ? formatDate(loan.latestRecoveryOn) : "—"}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeZone: "Africa/Kampala" }).format(date);
}

function querySuffix(filters: { officeId?: string; loanOfficerId?: string }) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

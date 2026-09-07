import { ShieldAlert, Download } from "lucide-react";
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
  agingBucketTone,
  formatBps,
  loadNonPerformingLoansReport,
  loadRiskFilterOptions,
  loanStatusTone,
  parseBoundedInteger,
  parseRiskFilters,
} from "@/modules/reports/domain/risk-report";

export default async function NonPerformingLoansReportPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; loanOfficerId?: string; thresholdDays?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportNonPerformingLoans,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const filters = parseRiskFilters(params);
  const thresholdDays = parseBoundedInteger(params.thresholdDays, 90, { min: 1, max: 3650 });
  const [report, options, pickerOptions] = await Promise.all([
    loadNonPerformingLoansReport(prisma, scope, filters, thresholdDays),
    loadRiskFilterOptions(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Risk", href: "/reports" },
          { label: "Non-Performing Loans" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Portfolio risk</p>
          <h1>Non-Performing Loans</h1>
          <p>
            Threshold {thresholdDays} days · {report.totals.loanCount.toLocaleString()} loans · {formatMinor(report.totals.totalOutstandingPrincipalMinor, "UGX")} outstanding principal
          </p>
        </div>
        <ReportPicker current="/reports/risk/non-performing-loans" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={`/api/reports/risk/non-performing-loans${querySuffix(filters, thresholdDays)}&format=csv`}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href={`/api/reports/risk/non-performing-loans${querySuffix(filters, thresholdDays)}`}>
            API JSON
          </Link>
          <Link className="secondary-action" href="/loans?status=IN_ARREARS">
            In-arrears loans
          </Link>
        </div>
      </header>

      <section className="loan-summary-metrics">
        <article>
          <span>NPL threshold</span>
          <strong>{thresholdDays} days</strong>
        </article>
        <article>
          <span>NPL principal</span>
          <strong>{formatMinor(report.totals.totalOutstandingPrincipalMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Open portfolio share</span>
          <strong>{formatBps(report.totals.shareOfOpenPortfolioBps)}</strong>
        </article>
        <article>
          <span>NPL loans</span>
          <strong>{report.totals.loanCount.toLocaleString()}</strong>
        </article>
      </section>

      <section className="panel form-panel">
        <form className="entity-form" method="get">
          <div className="form-row three">
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
            <label>
              <span>Threshold days</span>
              <input name="thresholdDays" type="number" min={1} max={3650} defaultValue={thresholdDays} />
            </label>
          </div>
          <div className="form-actions">
            <Link className="secondary-action" href="/reports/risk/non-performing-loans">
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
            <h2>NPL register</h2>
            <p>Loans are included when days overdue exceed the threshold or the servicing status is already IN_ARREARS.</p>
          </div>
          <ShieldAlert size={19} />
        </div>
        {report.loans.length === 0 ? (
          <div className="empty-state">
            <ShieldAlert size={28} />
            <strong>No non-performing loans in scope</strong>
            <p>Change the filter or threshold and try again.</p>
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
                  <th>Status</th>
                  <th>Bucket</th>
                  <th>Days overdue</th>
                  <th>Outstanding principal</th>
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
                    <td>
                      <span className={`status ${loanStatusTone(loan.status)}`}>{loan.status.replaceAll("_", " ")}</span>
                    </td>
                    <td>
                      <span className={`status ${agingBucketTone(loan.agingBucket)}`}>{bucketLabel(loan.agingBucket)}</span>
                    </td>
                    <td>{loan.daysOverdue.toLocaleString()}</td>
                    <td>{formatMinor(loan.outstandingPrincipalMinor, loan.currencyCode)}</td>
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

function bucketLabel(bucket: string) {
  switch (bucket) {
    case "CURRENT":
      return "Current";
    case "1_30":
      return "1-30 days";
    case "31_60":
      return "31-60 days";
    case "61_90":
      return "61-90 days";
    default:
      return "90+ days";
  }
}

function querySuffix(filters: { officeId?: string; loanOfficerId?: string }, thresholdDays: number) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  params.set("thresholdDays", String(thresholdDays));
  return `?${params.toString()}`;
}

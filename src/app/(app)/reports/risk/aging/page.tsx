import { CircleDollarSign } from "lucide-react";
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
  agingBucketTone,
  formatBps,
  loadAgingReport,
  loadRiskFilterOptions,
  loanStatusTone,
  parseRiskFilters,
} from "@/modules/reports/domain/risk-report";

export default async function AgingReportPage({
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
    permissions.reportAging,
  );
  if (!allowed) redirect("/reports");

  const filters = parseRiskFilters(await searchParams);
  const [report, options] = await Promise.all([
    loadAgingReport(prisma, scope, filters),
    loadRiskFilterOptions(prisma, scope),
  ]);
  const generatedAt = formatDateTime(report.generatedAt);

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Risk", href: "/reports" },
          { label: "Aging / Portfolio-at-Risk" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Portfolio risk</p>
          <h1>Aging / Portfolio-at-Risk</h1>
          <p>
            {report.totals.loanCount.toLocaleString()} open loans · {formatMinor(report.totals.totalOutstandingPrincipalMinor, "UGX")} outstanding principal · snapshot {generatedAt}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href={`/api/reports/risk/aging${querySuffix(filters)}`}>
            API JSON
          </Link>
          <Link className="secondary-action" href="/loans?status=IN_ARREARS">
            In-arrears loans
          </Link>
        </div>
      </header>

      <section className="loan-summary-metrics">
        <article>
          <span>Outstanding principal</span>
          <strong>{formatMinor(report.totals.totalOutstandingPrincipalMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Overdue principal</span>
          <strong>{formatMinor(report.totals.overdueOutstandingPrincipalMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Overall PAR</span>
          <strong>{formatBps(report.totals.overallParBps)}</strong>
        </article>
        <article>
          <span>Overdue loans</span>
          <strong>{report.totals.overdueLoanCount.toLocaleString()}</strong>
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
            <Link className="secondary-action" href="/reports/risk/aging">
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
            <h2>Bucket summary</h2>
            <p>Cumulative PAR shows the selected bucket and every worse bucket above it.</p>
          </div>
          <CircleDollarSign size={19} />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Loans</th>
                <th>Outstanding principal</th>
                <th>PAR ratio</th>
                <th>Cumulative PAR</th>
              </tr>
            </thead>
            <tbody>
              {report.buckets.map((bucket) => (
                <tr key={bucket.key}>
                  <td>
                    <strong>{bucket.label}</strong>
                  </td>
                  <td>{bucket.loanCount.toLocaleString()}</td>
                  <td>{formatMinor(bucket.outstandingPrincipalMinor, "UGX")}</td>
                  <td>{formatBps(bucket.bucketParBps)}</td>
                  <td>{formatBps(bucket.cumulativeParBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Loan-level aging</h2>
            <p>Each loan is bucketed by the earliest unpaid overdue installment.</p>
          </div>
        </div>
        {report.loans.length === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No loans in scope</strong>
            <p>Change the filter and try again.</p>
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

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Kampala",
  }).format(date);
}

function querySuffix(filters: { officeId?: string; loanOfficerId?: string }) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

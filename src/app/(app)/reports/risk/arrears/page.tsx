import { CircleDollarSign, Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPagination } from "@/components/report-pagination";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { paginateItems, parseReportPagination } from "@/modules/reports/domain/report-pagination";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  agingBucketTone,
  loadArrearsReport,
  loadRiskFilterOptions,
  loanStatusTone,
  parseRiskFilters,
} from "@/modules/reports/domain/risk-report";

export default async function ArrearsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; loanOfficerId?: string; page?: string; pageSize?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportArrears,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const filters = parseRiskFilters(params);
  const pagination = parseReportPagination(params);
  const [report, options, pickerOptions] = await Promise.all([
    loadArrearsReport(prisma, scope, filters),
    loadRiskFilterOptions(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const loanPage = paginateItems(report.loans, pagination);
  const generatedAt = formatDateTime(report.generatedAt);
  const exportHref = `/api/reports/risk/arrears${querySuffix(filters)}${querySuffix(filters) ? "&" : "?"}format=csv`;
  const pageQuery = {
    officeId: filters.officeId,
    loanOfficerId: filters.loanOfficerId,
    pageSize: pagination.pageSize === 50 ? undefined : String(pagination.pageSize),
  };

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Risk", href: "/reports" },
          { label: "Arrears Report" },
        ]}
      />
      <header className="directory-header">
        <div>
          <h1>Arrears Report</h1>
          <p>
            {report.totals.loanCount.toLocaleString()} loans in arrears · snapshot {generatedAt}
          </p>
        </div>
        <ReportPicker current="/reports/risk/arrears" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href="/loans?status=IN_ARREARS">
            In-arrears loans
          </Link>
        </div>
      </header>

      <section className="loan-summary-metrics">
        <article>
          <span>Overdue principal</span>
          <strong>{formatMinor(report.totals.overduePrincipalMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Overdue interest</span>
          <strong>{formatMinor(report.totals.overdueInterestMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Overdue fees</span>
          <strong>{formatMinor(report.totals.overdueFeesMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Overdue monitoring fee</span>
          <strong>{formatMinor(report.totals.overdueMonitoringFeeMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Overdue penalties</span>
          <strong>{formatMinor(report.totals.overduePenaltiesMinor, "UGX")}</strong>
        </article>
      </section>

      <section className="panel report-toolbar">
        <form className="report-toolbar-form" method="get">
          <label>
            Office
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
            Loan officer
            <select name="loanOfficerId" defaultValue={filters.loanOfficerId ?? ""}>
              <option value="">All loan officers</option>
              {options.loanOfficers.map((loanOfficer) => (
                <option key={loanOfficer.id} value={loanOfficer.id}>
                  {loanOfficer.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" type="submit">
            Apply
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Loans in arrears</h2>
            <p>{loanPage.pageSize} per page · unpaid installments due before today</p>
          </div>
        </div>
        {loanPage.totalRows === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No arrears in scope</strong>
            <p>Change the filter and try again.</p>
          </div>
        ) : (
          <>
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
                    <th>Principal overdue</th>
                    <th>Interest overdue</th>
                    <th>Fees overdue</th>
                    <th>Monitoring fee overdue</th>
                    <th>Penalties overdue</th>
                    <th>Total overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {loanPage.items.map((loan) => (
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
                      <td>{formatMinor(loan.overduePrincipalMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.overdueInterestMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.overdueFeesMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.overdueMonitoringFeeMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.overduePenaltiesMinor, loan.currencyCode)}</td>
                      <td>{formatMinor(loan.overdueTotalMinor, loan.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ReportPagination
              label="Arrears loan pages"
              page={loanPage.page}
              pageSize={loanPage.pageSize}
              pathname="/reports/risk/arrears"
              query={pageQuery}
              totalPages={loanPage.totalPages}
              totalRows={loanPage.totalRows}
            />
          </>
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
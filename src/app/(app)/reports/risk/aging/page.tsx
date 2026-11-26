import { CircleDollarSign, Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPagination } from "@/components/report-pagination";
import { ReportPicker } from "@/components/report-picker";
import { parseReportTab, ReportTableTabs } from "@/components/report-table-tabs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { paginateItems, parseReportPagination } from "@/modules/reports/domain/report-pagination";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  formatBps,
  loadAgingReport,
  loadRiskFilterOptions,
  parseRiskFilters,
} from "@/modules/reports/domain/risk-report";

const TABS = ["summary", "loans"] as const;

export default async function AgingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; loanOfficerId?: string; tab?: string; page?: string; pageSize?: string }>;
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

  const params = await searchParams;
  const filters = parseRiskFilters(params);
  const tab = parseReportTab(params.tab, TABS, "loans");
  const pagination = parseReportPagination(params);
  const [report, options, pickerOptions] = await Promise.all([
    loadAgingReport(prisma, scope, filters),
    loadRiskFilterOptions(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const arrearsLoans = report.loans.filter((loan) => loan.daysOverdue > 0);
  const loanPage = paginateItems(arrearsLoans, pagination);
  const generatedAt = formatDateTime(report.generatedAt);
  const exportHref = `/api/reports/risk/aging${querySuffix(filters)}${querySuffix(filters) ? "&" : "?"}format=csv`;
  const tabQuery = {
    officeId: filters.officeId,
    loanOfficerId: filters.loanOfficerId,
    tab,
    pageSize: pagination.pageSize === 50 ? undefined : String(pagination.pageSize),
  };

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
          <h1>Aging / Portfolio-at-Risk</h1>
          <p>
            {arrearsLoans.length.toLocaleString()} loans in arrears · snapshot {generatedAt}
          </p>
          <p className="field-hint">
            The download lists every loan in arrears, on every page, with the office and officer filters applied. Columns match the aging sheet: client, original and paid amounts, overdue principal and interest, days in arrears, and the week and day bands.
          </p>
        </div>
        <ReportPicker current="/reports/risk/aging" options={pickerOptions} />
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

      <section className="panel report-toolbar">
        <form className="report-toolbar-form" method="get">
          <input name="tab" type="hidden" value={tab} />
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

      <ReportTableTabs
        active={tab}
        pathname="/reports/risk/aging"
        query={{ officeId: filters.officeId, loanOfficerId: filters.loanOfficerId }}
        tabs={[
          { id: "summary", label: "Bucket summary" },
          { id: "loans", label: "Loans", count: arrearsLoans.length },
        ]}
      />

      {tab === "summary" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Bucket summary</h2>
              <p>Cumulative PAR includes the selected bucket and every worse bucket.</p>
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
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Loan-level aging</h2>
              <p>Same columns as the aging download · {loanPage.pageSize} per page</p>
            </div>
          </div>
          {loanPage.totalRows === 0 ? (
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>No loans in arrears</strong>
              <p>Change the filter and try again.</p>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="clickable-rows">
                  <thead>
                    <tr>
                      <th>Office/Branch</th>
                      <th>Client</th>
                      <th>Loan</th>
                      <th>Loan amount</th>
                      <th>Original interest</th>
                      <th>Principal paid</th>
                      <th>Interest paid</th>
                      <th>Principal overdue</th>
                      <th>Interest overdue</th>
                      <th>Days in arrears</th>
                      <th>Weeks band</th>
                      <th>Days band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanPage.items.map((loan) => (
                      <tr key={loan.id}>
                        <td>{loan.officeName}</td>
                        <td>
                          <strong>{loan.borrowerName}</strong>
                          <small className="mono">{loan.clientAccountNumber}</small>
                          <Link className="row-link" href={`/loans/${loan.id}`} aria-label={`Open ${loan.accountNumber}`} />
                        </td>
                        <td className="mono">{loan.accountNumber}</td>
                        <td>{formatMinor(loan.principalMinor, loan.currencyCode)}</td>
                        <td>{formatMinor(loan.originalInterestMinor, loan.currencyCode)}</td>
                        <td>{formatMinor(loan.principalRepaidMinor, loan.currencyCode)}</td>
                        <td>{formatMinor(loan.interestRepaidMinor, loan.currencyCode)}</td>
                        <td>{formatMinor(loan.overduePrincipalMinor, loan.currencyCode)}</td>
                        <td>{formatMinor(loan.overdueInterestMinor, loan.currencyCode)}</td>
                        <td>{loan.daysOverdue.toLocaleString()}</td>
                        <td>{loan.weeksInArrearsBand}</td>
                        <td>{loan.daysInArrearsBand}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ReportPagination
                label="Aging loan pages"
                page={loanPage.page}
                pageSize={loanPage.pageSize}
                pathname="/reports/risk/aging"
                query={tabQuery}
                totalPages={loanPage.totalPages}
                totalRows={loanPage.totalRows}
              />
            </>
          )}
        </section>
      )}
    </main>
  );
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

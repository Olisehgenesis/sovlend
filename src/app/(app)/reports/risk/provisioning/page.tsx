import { PiggyBank, Download } from "lucide-react";
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
  loadProvisioningReport,
  loadRiskFilterOptions,
  parseRiskFilters,
  provisioningBucketTone,
} from "@/modules/reports/domain/risk-report";

const TABS = ["summary", "loans"] as const;

export default async function ProvisioningReportPage({
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
    permissions.reportProvisioning,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const filters = parseRiskFilters(params);
  const tab = parseReportTab(params.tab, TABS, "summary");
  const pagination = parseReportPagination(params);
  const [report, options, pickerOptions, canPostProvisioning] = await Promise.all([
    loadProvisioningReport(prisma, scope, filters),
    loadRiskFilterOptions(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
    new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, scope.organizationId, permissions.ledgerPost),
  ]);
  const loanPage = paginateItems(report.loans, pagination);
  const exportHref = `/api/reports/risk/provisioning${querySuffix(filters)}${querySuffix(filters) ? "&" : "?"}format=csv`;
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
          { label: "Provisioning" },
        ]}
      />
      <header className="directory-header">
        <div>
          <h1>Provisioning</h1>
          <p>{report.totals.loanCount.toLocaleString()} loans in scope</p>
        </div>
        <ReportPicker current="/reports/risk/provisioning" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href="/reports/risk/aging">
            Aging report
          </Link>
          {canPostProvisioning ? (
            <Link className="secondary-action" href="/backoffice/accounting/provisioning">
              Post provisioning entry
            </Link>
          ) : null}
        </div>
      </header>

      <section className="loan-summary-metrics">
        <article>
          <span>Outstanding principal</span>
          <strong>{formatMinor(report.totals.totalPrincipalMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Required provision</span>
          <strong>{formatMinor(report.totals.totalProvisionMinor, "UGX")}</strong>
        </article>
        <article>
          <span>Coverage ratio</span>
          <strong>{formatBps(report.totals.coverageBps)}</strong>
        </article>
        <article>
          <span>Loans covered</span>
          <strong>{report.totals.loanCount.toLocaleString()}</strong>
        </article>
      </section>
      <p className="field-hint">Each bucket is outstanding principal, classified by days past due. Loss (180+ days) is 100% of that principal, so it stays inside the portfolio. Interest, fees, and penalties are not provisioned.</p>

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
        pathname="/reports/risk/provisioning"
        query={{ officeId: filters.officeId, loanOfficerId: filters.loanOfficerId }}
        tabs={[
          { id: "summary", label: "Provision ladder" },
          { id: "loans", label: "Loans", count: report.loans.length },
        ]}
      />

      {tab === "summary" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Provision ladder</h2>
              <p>Normal 1%, Watch 5%, Substandard 25%, Doubtful 50%, Loss 100%.</p>
            </div>
            <PiggyBank size={19} />
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Rate</th>
                  <th>Loans</th>
                  <th>Outstanding principal</th>
                  <th>Required provision</th>
                </tr>
              </thead>
              <tbody>
                {report.buckets.map((bucket) => (
                  <tr key={bucket.key}>
                    <td>
                      <span className={`status ${provisioningBucketTone(bucket.key)}`}>{bucket.label}</span>
                    </td>
                    <td>{bucket.provisionRatePercent}%</td>
                    <td>{bucket.loanCount.toLocaleString()}</td>
                    <td>{formatMinor(bucket.outstandingMinor, "UGX")}</td>
                    <td>{formatMinor(bucket.provisionMinor, "UGX")}</td>
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
              <h2>Loan-level provision</h2>
              <p>{loanPage.pageSize} per page</p>
            </div>
          </div>
          {loanPage.totalRows === 0 ? (
            <div className="empty-state">
              <PiggyBank size={28} />
              <strong>No loans in scope</strong>
              <p>Change the filter and try again.</p>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="clickable-rows">
                  <thead>
                    <tr>
                      <th>Borrower</th>
                      <th>Office</th>
                      <th>Officer</th>
                      <th>Bucket</th>
                      <th>Days overdue</th>
                      <th>Outstanding principal</th>
                      <th>Rate</th>
                      <th>Provision</th>
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
                        <td>{loan.officeName}</td>
                        <td>{loan.loanOfficerName}</td>
                        <td>
                          <span className={`status ${provisioningBucketTone(loan.provisioningBucket)}`}>{bucketLabel(loan.provisioningBucket)}</span>
                        </td>
                        <td>{loan.daysOverdue.toLocaleString()}</td>
                        <td>{formatMinor(loan.outstandingMinor, loan.currencyCode)}</td>
                        <td>{loan.provisionRatePercent}%</td>
                        <td>{formatMinor(loan.provisionMinor, loan.currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ReportPagination
                label="Provisioning loan pages"
                page={loanPage.page}
                pageSize={loanPage.pageSize}
                pathname="/reports/risk/provisioning"
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

function bucketLabel(bucket: string) {
  switch (bucket) {
    case "NORMAL":
      return "Normal";
    case "WATCH":
      return "Watch (1-30d)";
    case "SUBSTANDARD":
      return "Substandard (31-90d)";
    case "DOUBTFUL":
      return "Doubtful (91-180d)";
    default:
      return "Loss (180+d)";
  }
}

function querySuffix(filters: { officeId?: string; loanOfficerId?: string }) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  const query = params.toString();
  return query ? `?${query}` : "";
}
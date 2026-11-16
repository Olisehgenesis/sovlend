import { Download, Wallet } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPagination } from "@/components/report-pagination";
import { ReportPicker } from "@/components/report-picker";
import { parseReportTab, ReportTableTabs } from "@/components/report-table-tabs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { paginateItems, parseReportPagination } from "@/modules/reports/domain/report-pagination";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  formatLoanStatus,
  formatReportDate,
  loadActiveLoanFundBreakdownReport,
  loanStatusTone,
  loadActiveLoansReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

const TABS = ["funds", "loans"] as const;

export default async function ActiveLoansPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; loanOfficerId?: string; tab?: string; page?: string; pageSize?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportActiveLoans,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const tab = parseReportTab(params.tab, TABS, "funds");
  const pagination = parseReportPagination(params);
  const filterQuery = { officeId: params.officeId, loanOfficerId: params.loanOfficerId };
  const query = querySuffix(filterQuery);
  const [report, fundBreakdown, pickerOptions] = await Promise.all([
    tab === "loans" ? loadActiveLoansReport(prisma, context.scope, filterQuery) : Promise.resolve(null),
    tab === "funds" ? loadActiveLoanFundBreakdownReport(prisma, context.scope, filterQuery) : Promise.resolve(null),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const loanPage = report ? paginateItems(report.rows, pagination) : null;
  const openLoanCount = report?.rows.length ?? fundBreakdown?.totals.reduce((sum, row) => sum + row.loanCount, 0) ?? 0;
  const apiHref = `/api/reports/operations/active-loans${query}`;
  const exportHref = `${apiHref}${query ? "&" : "?"}format=csv`;
  const tabQuery = {
    officeId: params.officeId,
    loanOfficerId: params.loanOfficerId,
    tab,
    pageSize: pagination.pageSize === 50 ? undefined : String(pagination.pageSize),
  };

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "Active Loans" },
        ]}
      />
      <header className="directory-header">
        <div>
          <h1>Active Loans</h1>
          <p>{openLoanCount.toLocaleString()} open loans in scope</p>
        </div>
        <ReportPicker current="/reports/operations/active-loans" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      <section className="panel report-toolbar">
        <form className="report-toolbar-form" method="GET">
          <input name="tab" type="hidden" value={tab} />
          <label>
            Office
            <select defaultValue={params.officeId ?? ""} name="officeId">
              <option value="">All offices</option>
              {context.offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Loan officer
            <select defaultValue={params.loanOfficerId ?? ""} name="loanOfficerId">
              <option value="">All officers</option>
              {context.officers.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.name}
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
        pathname="/reports/operations/active-loans"
        query={{ officeId: params.officeId, loanOfficerId: params.loanOfficerId }}
        tabs={[
          { id: "funds", label: "By fund" },
          { id: "loans", label: "Register", count: openLoanCount },
        ]}
      />

      {tab === "funds" && fundBreakdown ? (
        <section className="panel loan-table">
          <div className="panel-heading">
            <div>
              <h2>Portfolio by fund</h2>
            </div>
            <Wallet size={19} />
          </div>
          {fundBreakdown.rows.length === 0 ? (
            <div className="empty-state">
              <Wallet size={28} />
              <strong>No active loans</strong>
              <p>Change filters and try again.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fund</th>
                    <th>Currency</th>
                    <th>Loan count</th>
                    <th>Total principal</th>
                  </tr>
                </thead>
                <tbody>
                  {fundBreakdown.rows.map((row) => (
                    <tr key={`${row.fundId ?? "unassigned"}-${row.currencyCode}`}>
                      <td>
                        <strong>{row.fundName}</strong>
                      </td>
                      <td>{row.currencyCode}</td>
                      <td>{row.loanCount.toLocaleString()}</td>
                      <td>{formatMinor(row.principalMinor, row.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {fundBreakdown.totals.map((row) => (
                    <tr key={`fund-total-${row.currencyCode}`}>
                      <th>Grand total</th>
                      <th>{row.currencyCode}</th>
                      <th>{row.loanCount.toLocaleString()}</th>
                      <th>{formatMinor(row.principalMinor, row.currencyCode)}</th>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ) : report && loanPage ? (
        <section className="panel loan-table">
          <div className="panel-heading">
            <div>
              <h2>Active loan register</h2>
              <p>{loanPage.pageSize} per page</p>
            </div>
            <Wallet size={19} />
          </div>
          {loanPage.totalRows === 0 ? (
            <div className="empty-state">
              <Wallet size={28} />
              <strong>No loans match filters</strong>
              <p>Change filters and try again.</p>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="clickable-rows">
                  <thead>
                    <tr>
                      <th>Office/Branch</th>
                      <th>Currency</th>
                      <th>Loan Officer</th>
                      <th>Client</th>
                      <th>Loan Account No.</th>
                      <th>Product</th>
                      <th>Status</th>
                      <th>Loan Amount</th>
                      <th>Annual Nominal Interest Rate</th>
                      <th>Disbursed Date</th>
                      <th>Expected Matured On</th>
                      <th>Principal Repaid</th>
                      <th>Principal Outstanding</th>
                      <th>Principal Overdue</th>
                      <th>Interest Repaid</th>
                      <th>Interest Outstanding</th>
                      <th>Interest Overdue</th>
                      <th>Fees Repaid</th>
                      <th>Monitoring Fee Repaid</th>
                      <th>Fees Outstanding</th>
                      <th>Monitoring Fee Outstanding</th>
                      <th>Fees Overdue</th>
                      <th>Monitoring Fee Overdue</th>
                      <th>Penalties Repaid</th>
                      <th>Penalties Outstanding</th>
                      <th>Penalties Overdue</th>
                      <th>Total Outstanding</th>
                      <th>Days overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanPage.items.map((row) => (
                      <tr key={row.loanId}>
                        <td>{row.officeName}</td>
                        <td>{row.currencyCode}</td>
                        <td>{row.loanOfficerName}</td>
                        <td>
                          <strong>{row.borrowerName}</strong>
                          <Link aria-label={`Open loan ${row.accountNumber}`} className="row-link" href={`/loans/${row.loanId}`} />
                        </td>
                        <td className="mono">{row.accountNumber}</td>
                        <td>{row.productName}</td>
                        <td>
                          <span className={`status ${loanStatusTone(row.status)}`}>{formatLoanStatus(row.status)}</span>
                        </td>
                        <td>{formatMinor(row.principalMinor, row.currencyCode)}</td>
                        <td>{(row.annualRateBps / 100).toFixed(2)}%</td>
                        <td>{row.disbursedOn ? formatReportDate(row.disbursedOn) : "—"}</td>
                        <td>{row.maturesOn ? formatReportDate(row.maturesOn) : "—"}</td>
                        <td>{formatMinor(row.principalRepaidMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.outstandingPrincipalMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.overduePrincipalMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.interestRepaidMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.outstandingInterestMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.overdueInterestMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.feesRepaidMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.monitoringFeeRepaidMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.outstandingFeesMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.outstandingMonitoringFeeMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.overdueFeesMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.overdueMonitoringFeeMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.penaltiesRepaidMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.outstandingPenaltiesMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.overduePenaltiesMinor, row.currencyCode)}</td>
                        <td>{formatMinor(row.outstandingTotalMinor, row.currencyCode)}</td>
                        <td>{row.daysOverdue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {report.totals.map((row) => (
                      <tr key={`total-${row.currencyCode}`}>
                        <th colSpan={7}>Grand total ({row.loanCount.toLocaleString()} loans)</th>
                        <th>{formatMinor(row.principalMinor, row.currencyCode)}</th>
                        <th colSpan={4}>{row.currencyCode}</th>
                        <th>{formatMinor(row.outstandingPrincipalMinor, row.currencyCode)}</th>
                        <th colSpan={13} />
                        <th>{formatMinor(row.outstandingTotalMinor, row.currencyCode)}</th>
                        <th />
                      </tr>
                    ))}
                  </tfoot>
                </table>
              </div>
              <ReportPagination
                label="Active loan pages"
                page={loanPage.page}
                pageSize={loanPage.pageSize}
                pathname="/reports/operations/active-loans"
                query={tabQuery}
                totalPages={loanPage.totalPages}
                totalRows={loanPage.totalRows}
              />
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}

function querySuffix(filters: { officeId?: string; loanOfficerId?: string }) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  const query = params.toString();
  return query ? `?${query}` : "";
}
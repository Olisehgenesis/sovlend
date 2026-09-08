import { Building2, Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  formatPercent,
  formatReportDate,
  loadBranchPortfolioReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";
import { branchPortfolioBucketLabels, branchPortfolioBucketOrder } from "@/modules/reports/domain/risk-report";

export default async function BranchPortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportBranchPortfolio,
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const query = querySuffix(params);
  const [report, pickerOptions] = await Promise.all([
    loadBranchPortfolioReport(prisma, context.scope, {
      date: params.date,
    }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const apiHref = `/api/reports/operations/branch-portfolio${query}`;
  const exportHref = `${apiHref}${query ? "&" : "?"}format=csv`;

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "Branch Portfolio" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Operations report</p>
          <h1>Branch portfolio</h1>
          <p>
            Loan-officer active book, outstanding balances, savings, and day-bucket PAR for{" "}
            {formatReportDate(report.asOfDate)}. Matches iLend&apos;s canned &quot;Branch Portfolio&quot; report,
            which is grouped by loan officer.
          </p>
        </div>
        <ReportPicker current="/reports/operations/branch-portfolio" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href={apiHref}>
            API JSON
          </Link>
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
        </div>
      </header>

      <section className="panel form-panel">
        <form className="entity-form compact-mapping" method="GET">
          <div className="form-row">
            <label>
              <span>As of date</span>
              <input name="date" type="date" defaultValue={params.date ?? ""} />
            </label>
          </div>
          <div className="form-actions">
            <button className="invest-button" type="submit">
              Apply filters
            </button>
            <Link className="secondary-action" href="/reports/operations/branch-portfolio">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Loan officer portfolio breakdown</h2>
            <p>{report.rows.length.toLocaleString()} loan officer/currency row(s)</p>
          </div>
          <Building2 size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <Building2 size={28} />
            <strong>No active loans in scope</strong>
            <p>Once officers hold active loans they will appear here.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Loan officer</th>
                  <th>Currency</th>
                  <th>NOL</th>
                  <th>Principal outstanding</th>
                  <th>Interest outstanding</th>
                  <th>Fees outstanding</th>
                  <th>Penalties outstanding</th>
                  <th>Total outstanding</th>
                  <th>Savings balance</th>
                  {branchPortfolioBucketOrder.map((bucket) => (
                    <th key={bucket}>{branchPortfolioBucketLabels[bucket]}</th>
                  ))}
                  <th>Total PAR</th>
                  <th>Total PAR %</th>
                  <th>Disbursed this month</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.loanOfficerId ?? "unassigned"}-${row.currencyCode}`}>
                    <td>
                      <strong>{row.loanOfficerName}</strong>
                    </td>
                    <td>{row.currencyCode}</td>
                    <td>{row.activeLoanCount.toLocaleString()}</td>
                    <td>{formatMinor(row.outstandingPrincipalMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.outstandingInterestMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.outstandingFeesMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.outstandingPenaltiesMinor, row.currencyCode)}</td>
                    <td>
                      <strong>{formatMinor(row.outstandingTotalMinor, row.currencyCode)}</strong>
                    </td>
                    <td>{formatMinor(row.savingsBalanceMinor, row.currencyCode)}</td>
                    {branchPortfolioBucketOrder.map((bucket) => (
                      <td key={bucket}>
                        <strong>{formatMinor(row.buckets[bucket].amountMinor, row.currencyCode)}</strong>
                        <small>{formatPercent(row.buckets[bucket].percent)}</small>
                      </td>
                    ))}
                    <td>{formatMinor(row.totalParMinor, row.currencyCode)}</td>
                    <td>{formatPercent(row.totalParPercent)}</td>
                    <td>{formatMinor(row.disbursedThisMonthMinor, row.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {report.totals.map((row) => (
                  <tr key={`total-${row.currencyCode}`}>
                    <th>Grand total</th>
                    <th>{row.currencyCode}</th>
                    <th>{row.activeLoanCount.toLocaleString()}</th>
                    <th>{formatMinor(row.outstandingPrincipalMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.outstandingInterestMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.outstandingFeesMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.outstandingPenaltiesMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.outstandingTotalMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.savingsBalanceMinor, row.currencyCode)}</th>
                    {branchPortfolioBucketOrder.map((bucket) => (
                      <th key={bucket}>{formatMinor(row.buckets[bucket], row.currencyCode)}</th>
                    ))}
                    <th>{formatMinor(row.totalParMinor, row.currencyCode)}</th>
                    <th>{formatPercent(row.totalParPercent)}</th>
                    <th>{formatMinor(row.disbursedThisMonthMinor, row.currencyCode)}</th>
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function querySuffix(filters: { date?: string }) {
  const params = new URLSearchParams();
  if (filters.date) params.set("date", filters.date);
  const query = params.toString();
  return query ? `?${query}` : "";
}

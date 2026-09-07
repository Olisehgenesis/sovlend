import { Building2 } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import {
  formatPercent,
  formatReportDate,
  loadBranchPortfolioReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

const parOptions = [0, 7, 30, 60, 90];

export default async function BranchPortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ parType?: string; date?: string }>;
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
  const report = await loadBranchPortfolioReport(prisma, context.scope, {
    parType: params.parType,
    date: params.date,
  });

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
            Office-level active book, outstanding principal, PAR&gt;{report.parDays}, and disbursals for {formatReportDate(report.asOfDate)}.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Filters</h2>
            <p>Adjust the PAR aging threshold without leaving the office breakdown.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Portfolio aging</legend>
            <div className="form-row">
              <label>
                PAR threshold
                <select defaultValue={String(report.parDays)} name="parType">
                  {parOptions.map((days) => (
                    <option key={days} value={days}>
                      PAR&gt;{days}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
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
            <h2>Office portfolio breakdown</h2>
            <p>{report.rows.length.toLocaleString()} office/currency row(s)</p>
          </div>
          <Building2 size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <Building2 size={28} />
            <strong>No active loans in scope</strong>
            <p>Once branches hold active loans they will appear here.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Office</th>
                  <th>Currency</th>
                  <th>Active loans</th>
                  <th>Loans at risk</th>
                  <th>PAR&gt;{report.parDays}</th>
                  <th>Outstanding principal</th>
                  <th>Disbursed this month</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.officeId}-${row.currencyCode}`}>
                    <td>
                      <strong>{row.officeName}</strong>
                    </td>
                    <td>{row.currencyCode}</td>
                    <td>{row.activeLoanCount.toLocaleString()}</td>
                    <td>{row.atRiskLoanCount.toLocaleString()}</td>
                    <td>{formatPercent(row.parPercent)}</td>
                    <td>{formatMinor(row.outstandingPrincipalMinor, row.currencyCode)}</td>
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
                    <th>{row.atRiskLoanCount.toLocaleString()}</th>
                    <th>{formatPercent(row.parPercent)}</th>
                    <th>{formatMinor(row.outstandingPrincipalMinor, row.currencyCode)}</th>
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

import { CircleDollarSign } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import {
  loadDisbursalCohortReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export default async function DisbursalCohortPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; loanOfficerId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportDisbursalCohort,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const report = await loadDisbursalCohortReport(prisma, context.scope, {
    startDate: params.startDate,
    endDate: params.endDate,
    loanOfficerId: params.loanOfficerId,
  });

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "All Loans by Disbursal Period" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Operations report</p>
          <h1>All loans by disbursal period</h1>
          <p>Monthly disbursal cohorts across your visible portfolio, newest month first.</p>
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
            <p>Narrow cohorts by date range or a single loan officer.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Disbursal window</legend>
            <div className="form-row three">
              <label>
                Start date
                <input defaultValue={params.startDate ?? ""} name="startDate" type="date" />
              </label>
              <label>
                End date
                <input defaultValue={params.endDate ?? ""} name="endDate" type="date" />
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
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" type="submit">
              Apply filters
            </button>
            <Link className="secondary-action" href="/reports/operations/disbursal-cohort">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Monthly disbursal cohorts</h2>
            <p>{report.rows.length.toLocaleString()} cohort row(s)</p>
          </div>
          <CircleDollarSign size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No disbursals match these filters</strong>
            <p>Try widening the dates or removing the officer filter.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Currency</th>
                  <th>Loans disbursed</th>
                  <th>Total principal</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.period}-${row.currencyCode}`}>
                    <td>
                      <strong>{row.period}</strong>
                    </td>
                    <td>{row.currencyCode}</td>
                    <td>{row.loanCount.toLocaleString()}</td>
                    <td>{formatMinor(row.principalMinor, row.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {report.totals.map((row) => (
                  <tr key={`total-${row.currencyCode}`}>
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
    </main>
  );
}

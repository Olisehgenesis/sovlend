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
  formatReportDate,
  isoDate,
  loadCollectionByOfficerReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export default async function CollectionByOfficerPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportCollectionByOfficer,
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const report = await loadCollectionByOfficerReport(prisma, context.scope, {
    date: params.date,
  });

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "Expected Daily Collection per Officer" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Operations report</p>
          <h1>Expected daily collection per officer</h1>
          <p>
            Scheduled collections for {formatReportDate(report.businessDate)}, with overdue arrears kept separate for recovery follow-up.
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
            <p>Run the officer view for any business date.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Business date</legend>
            <div className="form-row">
              <label>
                Date
                <input defaultValue={isoDate(report.businessDate)} name="date" type="date" />
              </label>
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" type="submit">
              Apply filters
            </button>
            <Link className="secondary-action" href="/reports/operations/collection-by-officer">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Officer collection queue</h2>
            <p>{report.rows.length.toLocaleString()} officer bucket(s)</p>
          </div>
          <CircleDollarSign size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No due installments for this date</strong>
            <p>Try another date or wait for new schedules to fall due.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Officer</th>
                  <th>Currency</th>
                  <th>Active loans</th>
                  <th>Due today</th>
                  <th>Overdue arrears</th>
                  <th>Total expected</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.officerId ?? "unassigned"}-${row.currencyCode}`}>
                    <td>
                      <strong>{row.officerName}</strong>
                    </td>
                    <td>{row.currencyCode}</td>
                    <td>{row.loanCount.toLocaleString()}</td>
                    <td>{formatMinor(row.dueTodayMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.overdueArrearsMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.expectedTotalMinor, row.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {report.totals.map((row) => (
                  <tr key={`total-${row.currencyCode}`}>
                    <th>Grand total</th>
                    <th>{row.currencyCode}</th>
                    <th>{row.loanCount.toLocaleString()}</th>
                    <th>{formatMinor(row.dueTodayMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.overdueArrearsMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.expectedTotalMinor, row.currencyCode)}</th>
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

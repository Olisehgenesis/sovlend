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
  formatLoanStatus,
  formatReportDate,
  loanStatusTone,
  loadOperationsReportContext,
  loadUnassignedLoansReport,
} from "@/modules/reports/domain/operations-report";

export default async function UnassignedLoansPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportUnassignedLoans,
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const report = await loadUnassignedLoansReport(prisma, context.scope);

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "Active Loans With No Assigned Officer" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Operations report</p>
          <h1>Active loans with no assigned officer</h1>
          <p>Data-hygiene queue for operational accounts that still need a staff owner.</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
        </div>
      </header>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Unassigned active accounts</h2>
            <p>{report.rows.length.toLocaleString()} loan account(s) need officer assignment</p>
          </div>
          <CircleDollarSign size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No unassigned active loans</strong>
            <p>Every active or in-arrears loan in your scope already has an officer.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>Loan account</th>
                  <th>Type</th>
                  <th>Office</th>
                  <th>Status</th>
                  <th>Principal</th>
                  <th>Disbursed</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.loanId}>
                    <td>
                      <strong>{row.borrowerName}</strong>
                      <Link
                        aria-label={`Open loan ${row.accountNumber}`}
                        className="row-link"
                        href={`/loans/${row.loanId}`}
                      />
                    </td>
                    <td className="mono">{row.accountNumber}</td>
                    <td>{row.borrowerType}</td>
                    <td>{row.officeName}</td>
                    <td>
                      <span className={`status ${loanStatusTone(row.status)}`}>
                        {formatLoanStatus(row.status)}
                      </span>
                    </td>
                    <td>{formatMinor(row.principalMinor, row.currencyCode)}</td>
                    <td>{row.disbursedOn ? formatReportDate(row.disbursedOn) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {report.totals.map((row) => (
                  <tr key={`total-${row.currencyCode}`}>
                    <th colSpan={5}>Principal total</th>
                    <th>{formatMinor(row.amountMinor, row.currencyCode)}</th>
                    <th>{row.currencyCode}</th>
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

import { CircleDollarSign, Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { DataTable } from "@/components/ui/data-table";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
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

  const [report, pickerOptions] = await Promise.all([
    loadUnassignedLoansReport(prisma, context.scope),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const apiHref = "/api/reports/operations/unassigned-loans";
  const exportHref = `${apiHref}?format=csv`;

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
        <ReportPicker current="/reports/operations/unassigned-loans" options={pickerOptions} />
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

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Unassigned active accounts</h2>
            <p>{report.rows.length.toLocaleString()} loan account(s) need officer assignment</p>
          </div>
          <CircleDollarSign size={19} />
        </div>
        <DataTable
          columns={[
            { key: "borrower", header: "Borrower", render: (row) => <strong>{row.borrowerName}</strong> },
            { key: "account", header: "Loan account", cellClassName: "mono", render: (row) => row.accountNumber },
            { key: "type", header: "Type", render: (row) => row.borrowerType },
            { key: "office", header: "Office", render: (row) => row.officeName },
            {
              key: "status",
              header: "Status",
              render: (row) => <span className={`status ${loanStatusTone(row.status)}`}>{formatLoanStatus(row.status)}</span>,
            },
            { key: "principal", header: "Principal", render: (row) => formatMinor(row.principalMinor, row.currencyCode) },
            { key: "disbursed", header: "Disbursed", render: (row) => (row.disbursedOn ? formatReportDate(row.disbursedOn) : "—") },
          ]}
          emptyState={
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>No unassigned active loans</strong>
              <p>Every active or in-arrears loan in your scope already has an officer.</p>
            </div>
          }
          footer={report.totals.map((row) => (
            <tr key={`total-${row.currencyCode}`}>
              <th colSpan={5}>Principal total</th>
              <th>{formatMinor(row.amountMinor, row.currencyCode)}</th>
              <th>{row.currencyCode}</th>
            </tr>
          ))}
          getRowAriaLabel={(row) => `Open loan ${row.accountNumber}`}
          getRowKey={(row) => row.loanId}
          rowHref={(row) => `/loans/${row.loanId}`}
          rows={report.rows}
        />
      </section>
    </main>
  );
}

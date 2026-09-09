import { Download, ShieldAlert } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { DataTable } from "@/components/ui/data-table";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { formatDisplayDateTime, loadGuarantorExposureReport } from "@/modules/reports/domain/insights-report";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";

export default async function GuarantorExposureReportPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportGuarantorExposure,
  );
  if (!allowed) redirect("/reports");

  const [report, pickerOptions] = await Promise.all([
    loadGuarantorExposureReport(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const exportHref = "/api/reports/insights/guarantor-exposure?format=csv";

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Insights", href: "/reports" }, { label: "Guarantor exposure" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">SovLend-only insight</p>
          <h1>Guarantor exposure report</h1>
          <p>
            {report.summary.repeatedGuarantorCount.toLocaleString()} repeat guarantors · {report.summary.concentrationRiskCount.toLocaleString()} concentration-risk matches · {formatMinor(report.summary.totalOutstandingMinor, report.summary.currencyCode)} backed
          </p>
        </div>
        <ReportPicker current="/reports/insights/guarantor-exposure" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href="/reports">All reports</Link>
          <Link className="secondary-action" href="/loans">Loans</Link>
        </div>
      </header>

      <section className="readiness-banner attention">
        <div>
          <strong>Approximate matching heuristic</strong>
          <span>Guarantors are deduplicated across loans by normalized first name + last name + phone digits because the source schema has no shared guarantor person ID.</span>
        </div>
        <div className="readiness-progress"><i style={{ width: "100%" }} /></div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Repeat guarantors</h2>
            <p>Generated {formatDisplayDateTime(new Date(report.generatedAt))}</p>
          </div>
          <ShieldAlert size={19} />
        </div>
        <DataTable
          columns={[
            {
              key: "guarantor",
              header: "Guarantor",
              render: (row) => (
                <>
                  <strong>{row.displayName}</strong>
                  <small>{row.loanCount} distinct loans</small>
                </>
              ),
            },
            { key: "phone", header: "Phone", cellClassName: "mono", render: (row) => row.phone },
            { key: "loanCount", header: "Loans backed", render: (row) => row.loanCount },
            {
              key: "concentration",
              header: "Arrears concentration",
              render: (row) => (
                <span className={`status ${row.concentrationRisk ? "in-arrears" : row.arrearsLoanCount > 0 ? "review" : "up-to-date"}`}>
                  {row.concentrationRisk ? `${row.arrearsLoanCount} arrears loans` : row.arrearsLoanCount === 0 ? "No arrears overlap" : `${row.arrearsLoanCount} in arrears`}
                </span>
              ),
            },
            {
              key: "exposure",
              header: "Total exposure",
              render: (row) => formatMinor(row.totalOutstandingMinor, row.currencyCode),
            },
            {
              key: "backedLoans",
              header: "Backed loans",
              render: (row) => (
                <div style={{ display: "grid", gap: 4 }}>
                  {row.loans.map((loan) => (
                    <small key={loan.id}>
                      <strong>{loan.accountNumber}</strong> · {loan.borrowerName} · {loan.status.replaceAll("_", " ")} · {formatMinor(loan.outstandingPrincipalMinor, loan.currencyCode)}
                    </small>
                  ))}
                </div>
              ),
            },
          ]}
          emptyState={
            <div className="empty-state">
              <ShieldAlert size={28} />
              <strong>No repeat guarantors found</strong>
              <p>No guarantor identity pattern in your current scope appears on more than one loan.</p>
            </div>
          }
          getRowKey={(row) => row.key}
          rows={report.rows}
        />
      </section>
    </main>
  );
}

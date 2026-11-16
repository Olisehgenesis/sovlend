import { Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { parseReportDatePreset, ReportDatePresetPills } from "@/components/report-date-presets";
import { ReportPicker } from "@/components/report-picker";
import { formatDateInputValue, resolveDatePreset } from "@/modules/reports/domain/accounting-report";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  formatLoanStatus,
  formatReportDate,
  loadDisbursalReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export default async function DisbursalReportPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; loanOfficerId?: string; startDate?: string; endDate?: string; preset?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportDisbursalLedger,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const preset = parseReportDatePreset(params.preset);
  const resolvedRange = preset ? resolveDatePreset(new Date(), preset) : null;
  const startDate = resolvedRange ? formatDateInputValue(resolvedRange.startDate) : params.startDate;
  const endDate = resolvedRange ? formatDateInputValue(resolvedRange.endDate) : params.endDate;
  const filterParams = { officeId: params.officeId, loanOfficerId: params.loanOfficerId, startDate, endDate };
  const query = querySuffix(filterParams);
  const [report, pickerOptions] = await Promise.all([
    loadDisbursalReport(prisma, context.scope, filterParams),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const apiHref = `/api/reports/operations/disbursal-report${query}`;
  const exportHref = `${apiHref}${query ? "&" : "?"}format=csv`;

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "Disbursal Report" },
        ]}
      />
      <header className="directory-header">
        <div>
          <h1>Disbursal Report</h1>
          <p>Chronological ledger of individual loan disbursements, newest first.</p>
        </div>
        <ReportPicker current="/reports/operations/disbursal-report" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      <section className="panel report-toolbar">
        <ReportDatePresetPills
          active={preset}
          pathname="/reports/operations/disbursal-report"
          query={{
            officeId: params.officeId,
            loanOfficerId: params.loanOfficerId,
          }}
        />
        <form className="report-toolbar-form" method="GET">
          <label>
            From
            <input defaultValue={startDate ?? ""} name="startDate" type="date" />
          </label>
          <label>
            To
            <input defaultValue={endDate ?? ""} name="endDate" type="date" />
          </label>
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

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Loan disbursal ledger</h2>
            <p>{report.rows.length.toLocaleString()} disbursed loan row(s)</p>
          </div>
        </div>
        {report.rows.length === 0 ? (
          <p className="coa-section-empty">No disbursals match these filters.</p>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Disbursed</th>
                  <th>Borrower</th>
                  <th>Loan account</th>
                  <th>Office</th>
                  <th>Officer</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Principal</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.loanId}>
                    <td>{formatReportDate(row.disbursedOn)}</td>
                    <td>
                      <strong>{row.borrowerName}</strong>
                      <Link aria-label={`Open loan ${row.accountNumber}`} className="row-link" href={`/loans/${row.loanId}`} />
                    </td>
                    <td className="mono">{row.accountNumber}</td>
                    <td>{row.officeName}</td>
                    <td>{row.loanOfficerName}</td>
                    <td>{row.productName}</td>
                    <td>{formatLoanStatus(row.status)}</td>
                    <td>{formatMinor(row.principalMinor, row.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {report.totals.map((row) => (
                  <tr key={`total-${row.currencyCode}`}>
                    <th colSpan={6}>Grand total ({row.loanCount.toLocaleString()} disbursals)</th>
                    <th>{row.currencyCode}</th>
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

function querySuffix(filters: { officeId?: string; loanOfficerId?: string; startDate?: string; endDate?: string }) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  const query = params.toString();
  return query ? `?${query}` : "";
}

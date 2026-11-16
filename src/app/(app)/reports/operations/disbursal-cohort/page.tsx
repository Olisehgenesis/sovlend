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
import { loadDisbursalCohortReport, loadOperationsReportContext } from "@/modules/reports/domain/operations-report";

export default async function DisbursalCohortPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; loanOfficerId?: string; preset?: string }>;
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
  const preset = parseReportDatePreset(params.preset);
  const resolvedRange = preset ? resolveDatePreset(new Date(), preset) : null;
  const startDate = resolvedRange ? formatDateInputValue(resolvedRange.startDate) : params.startDate;
  const endDate = resolvedRange ? formatDateInputValue(resolvedRange.endDate) : params.endDate;
  const filterParams = { startDate, endDate, loanOfficerId: params.loanOfficerId };
  const query = querySuffix(filterParams);
  const [report, pickerOptions] = await Promise.all([
    loadDisbursalCohortReport(prisma, context.scope, filterParams),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const apiHref = `/api/reports/operations/disbursal-cohort${query}`;
  const exportHref = `${apiHref}${query ? "&" : "?"}format=csv`;

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
          <h1>All loans by disbursal period</h1>
          <p>Monthly disbursal cohorts, newest month first.</p>
        </div>
        <ReportPicker current="/reports/operations/disbursal-cohort" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      <section className="panel report-toolbar">
        <ReportDatePresetPills
          active={preset}
          pathname="/reports/operations/disbursal-cohort"
          query={{ loanOfficerId: params.loanOfficerId }}
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
            <h2>Monthly disbursal cohorts</h2>
            <p>{report.rows.length.toLocaleString()} cohort row(s)</p>
          </div>
        </div>
        {report.rows.length === 0 ? (
          <p className="coa-section-empty">No disbursals match these filters.</p>
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

function querySuffix(filters: { startDate?: string; endDate?: string; loanOfficerId?: string }) {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

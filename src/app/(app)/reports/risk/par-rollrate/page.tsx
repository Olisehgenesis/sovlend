import { BarChart3, Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  formatBps,
  loadParRollRateReport,
  loadRiskFilterOptions,
  parseBoundedInteger,
  parseRiskFilters,
  vintageBucketOrder,
} from "@/modules/reports/domain/risk-report";

export default async function ParRollRateReportPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; loanOfficerId?: string; cohortMonths?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportParRollRate,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const filters = parseRiskFilters(params);
  const cohortMonths = parseBoundedInteger(params.cohortMonths, 18, { min: 3, max: 60 });
  const [report, options, pickerOptions] = await Promise.all([
    loadParRollRateReport(prisma, scope, filters, cohortMonths),
    loadRiskFilterOptions(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Risk", href: "/reports" },
          { label: "PAR Roll-Rate / Vintage" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Portfolio risk</p>
          <h1>PAR Roll-Rate / Vintage</h1>
          <p>
            Last {cohortMonths} cohort months · {report.totals.cohortCount.toLocaleString()} cohorts · {formatMinor(report.totals.totalOriginalPrincipalMinor, "UGX")} original principal
          </p>
        </div>
        <ReportPicker current="/reports/risk/par-rollrate" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={`/api/reports/risk/par-rollrate${querySuffix(filters, cohortMonths)}&format=csv`}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href={`/api/reports/risk/par-rollrate${querySuffix(filters, cohortMonths)}`}>
            API JSON
          </Link>
          <Link className="secondary-action" href="/reports/risk/aging">
            Aging report
          </Link>
        </div>
      </header>

      <section className="loan-summary-metrics">
        <article>
          <span>Cohort months</span>
          <strong>{cohortMonths}</strong>
        </article>
        <article>
          <span>Cohorts</span>
          <strong>{report.totals.cohortCount.toLocaleString()}</strong>
        </article>
        <article>
          <span>90+ share</span>
          <strong>{formatBps(report.totals.ninetyPlusShareBps)}</strong>
        </article>
        <article>
          <span>Written-off share</span>
          <strong>{formatBps(report.totals.writtenOffShareBps)}</strong>
        </article>
      </section>

      <section className="panel form-panel">
        <form className="entity-form" method="get">
          <div className="form-row three">
            <label>
              <span>Office</span>
              <select name="officeId" defaultValue={filters.officeId ?? ""}>
                <option value="">All accessible offices</option>
                {options.offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Loan officer</span>
              <select name="loanOfficerId" defaultValue={filters.loanOfficerId ?? ""}>
                <option value="">All loan officers</option>
                {options.loanOfficers.map((loanOfficer) => (
                  <option key={loanOfficer.id} value={loanOfficer.id}>
                    {loanOfficer.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Cohort months</span>
              <input name="cohortMonths" type="number" min={3} max={60} defaultValue={cohortMonths} />
            </label>
          </div>
          <div className="form-actions">
            <Link className="secondary-action" href="/reports/risk/par-rollrate">
              Clear
            </Link>
            <button className="invest-button" type="submit">
              Apply filters
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Cohort matrix</h2>
            <p>{report.assumptions.currentDefinition}</p>
          </div>
          <BarChart3 size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <BarChart3 size={28} />
            <strong>No disbursed cohorts in scope</strong>
            <p>Change the filter or expand the cohort window and try again.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cohort</th>
                  <th>Loans</th>
                  <th>Original principal</th>
                  {vintageBucketOrder.map((bucket) => (
                    <th key={bucket}>{bucketLabel(bucket)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.cohortKey}>
                    <td>
                      <strong>{row.cohortLabel}</strong>
                    </td>
                    <td>{row.loanCount.toLocaleString()}</td>
                    <td>{formatMinor(row.originalPrincipalMinor, "UGX")}</td>
                    {vintageBucketOrder.map((bucket) => (
                      <td key={bucket}>
                        <strong>{formatBps(row.distribution[bucket].percentageBps)}</strong>
                        <small>{formatMinor(row.distribution[bucket].principalMinor, "UGX")}</small>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function bucketLabel(bucket: string) {
  switch (bucket) {
    case "CURRENT":
      return "Current";
    case "1_30":
      return "1-30";
    case "31_60":
      return "31-60";
    case "61_90":
      return "61-90";
    case "90_PLUS":
      return "90+";
    default:
      return "Written-off";
  }
}

function querySuffix(filters: { officeId?: string; loanOfficerId?: string }, cohortMonths: number) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  params.set("cohortMonths", String(cohortMonths));
  return `?${params.toString()}`;
}

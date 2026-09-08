import { Download, Users } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadOperationsReportContext } from "@/modules/reports/domain/operations-report";
import { loadSavingsPortfolioByOfficerReport } from "@/modules/reports/domain/savings-report";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";

export default async function SavingsPortfolioByOfficerPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportSavingsPortfolioByOfficer,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const [report, pickerOptions] = await Promise.all([
    loadSavingsPortfolioByOfficerReport(prisma, context.scope, { officeId: params.officeId }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const exportHref = params.officeId
    ? `/api/reports/savings/portfolio-by-officer?officeId=${encodeURIComponent(params.officeId)}&format=csv`
    : "/api/reports/savings/portfolio-by-officer?format=csv";

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Savings" },
          { label: "Savings Portfolio by Officer" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Savings report</p>
          <h1>Savings portfolio by officer</h1>
          <p>Total and average savings balances grouped by savings officer. Not part of iLend&apos;s canned reports — original to SovLend.</p>
        </div>
        <ReportPicker current="/reports/savings/portfolio-by-officer" options={pickerOptions} />
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Filters</h2>
            <p>Limit the roll-up to one office before exporting.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Office scope</legend>
            <div className="form-row">
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
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" type="submit">
              Apply filters
            </button>
            <Link className="secondary-action" href="/reports/savings/portfolio-by-officer">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Officer roll-up</h2>
            <p>{report.rows.length.toLocaleString()} officer/currency row(s)</p>
          </div>
          <Users size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <Users size={28} />
            <strong>No savings accounts match this office filter</strong>
            <p>Clear the filter or choose another office.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Savings Officer</th>
                  <th>Currency</th>
                  <th>Number of Accounts</th>
                  <th>Active Accounts</th>
                  <th>Total Balance</th>
                  <th>Average Balance</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.officerId ?? "unassigned"}::${row.currencyCode}`}>
                    <td>{row.officerName}</td>
                    <td>{row.currencyCode}</td>
                    <td>{row.accountCount.toLocaleString()}</td>
                    <td>{row.activeAccountCount.toLocaleString()}</td>
                    <td className="mono">{formatMinor(row.totalBalanceMinor, row.currencyCode)}</td>
                    <td className="mono">{formatMinor(row.averageBalanceMinor, row.currencyCode)}</td>
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

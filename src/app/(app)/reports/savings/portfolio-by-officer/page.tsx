import { Download, Users } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { ReportZeroToggle } from "@/components/report-zero-toggle";
import { DataTable } from "@/components/ui/data-table";
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
  searchParams: Promise<{ officeId?: string; showZero?: string }>;
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
  const showZero = params.showZero === "1";
  const [report, pickerOptions] = await Promise.all([
    loadSavingsPortfolioByOfficerReport(prisma, context.scope, {
      officeId: params.officeId,
      hideZeroBalances: !showZero,
    }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const exportQuery = new URLSearchParams();
  if (params.officeId) exportQuery.set("officeId", params.officeId);
  if (showZero) exportQuery.set("showZero", "1");
  exportQuery.set("format", "csv");
  const exportHref = `/api/reports/savings/portfolio-by-officer?${exportQuery.toString()}`;

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
            <ReportZeroToggle
              defaultChecked={showZero}
              label="Show officers with zero balance"
              name="showZero"
            />
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
            <p>
              {report.rows.length.toLocaleString()} officer/currency row(s)
              {!showZero ? " · zero-balance rows hidden" : ""}
            </p>
          </div>
          <Users size={19} />
        </div>
        <DataTable
          columns={[
            { key: "officer", header: "Savings Officer", render: (row) => row.officerName },
            { key: "currency", header: "Currency", render: (row) => row.currencyCode },
            { key: "accounts", header: "Number of Accounts", render: (row) => row.accountCount.toLocaleString() },
            { key: "active", header: "Active Accounts", render: (row) => row.activeAccountCount.toLocaleString() },
            { key: "total", header: "Total Balance", cellClassName: "mono", render: (row) => formatMinor(row.totalBalanceMinor, row.currencyCode) },
            { key: "average", header: "Average Balance", cellClassName: "mono", render: (row) => formatMinor(row.averageBalanceMinor, row.currencyCode) },
          ]}
          emptyState={
            <div className="empty-state">
              <Users size={28} />
              <strong>No savings accounts match this office filter</strong>
              <p>Clear the filter or choose another office.</p>
            </div>
          }
          getRowKey={(row) => `${row.officerId ?? "unassigned"}::${row.currencyCode}`}
          rows={report.rows}
        />
      </section>
    </main>
  );
}

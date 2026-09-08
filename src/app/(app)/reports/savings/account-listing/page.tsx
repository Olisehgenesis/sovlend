import { Download, PiggyBank } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { loadOperationsReportContext } from "@/modules/reports/domain/operations-report";
import {
  accountTypeLabel,
  isoDate,
  loadSavingsAccountListingReport,
  savingsStatusTone,
} from "@/modules/reports/domain/savings-report";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";

export default async function SavingsAccountListingPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportSavingsAccountListing,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const [report, pickerOptions] = await Promise.all([
    loadSavingsAccountListingReport(prisma, context.scope, { officeId: params.officeId }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const exportHref = params.officeId
    ? `/api/reports/savings/account-listing?officeId=${encodeURIComponent(params.officeId)}&format=csv`
    : "/api/reports/savings/account-listing?format=csv";

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Savings" },
          { label: "Savings Account Listing" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Savings report</p>
          <h1>Savings account listing</h1>
          <p>Exportable register of every savings account and its current balance. Not part of iLend&apos;s canned reports — original to SovLend.</p>
        </div>
        <ReportPicker current="/reports/savings/account-listing" options={pickerOptions} />
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
            <p>Limit the register to one office before exporting.</p>
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
            <Link className="secondary-action" href="/reports/savings/account-listing">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Savings accounts</h2>
            <p>{report.rows.length.toLocaleString()} account(s) in scope</p>
          </div>
          <PiggyBank size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <PiggyBank size={28} />
            <strong>No savings accounts match this office filter</strong>
            <p>Clear the filter or choose another office.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Office/Branch</th>
                  <th>Client</th>
                  <th>Savings Account No.</th>
                  <th>Product</th>
                  <th>Account Type</th>
                  <th>Status</th>
                  <th>Currency</th>
                  <th>Balance</th>
                  <th>Savings Officer</th>
                  <th>Opened Date</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.officeName}</td>
                    <td>
                      <strong>{row.ownerName}</strong>
                      <Link
                        aria-label={`Open savings account ${row.accountNumber}`}
                        className="row-link"
                        href={`/savings-accounts/${row.accountNumber}`}
                      />
                    </td>
                    <td className="mono">{row.accountNumber}</td>
                    <td>{row.productName}</td>
                    <td>{accountTypeLabel(row.accountType)}</td>
                    <td>
                      <span className={`status ${savingsStatusTone(row.status)}`}>{row.status}</span>
                    </td>
                    <td>{row.currencyCode}</td>
                    <td className="mono">{formatMinor(row.balanceMinor, row.currencyCode)}</td>
                    <td>{row.fieldOfficerName}</td>
                    <td>{row.openedOn ? isoDate(row.openedOn) : "—"}</td>
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

import { Download, Wallet } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
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
  loadOutstandingBalancesReport,
} from "@/modules/reports/domain/operations-report";

export default async function OutstandingBalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; loanOfficerId?: string; currencyCode?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportOutstandingBalances,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const query = querySuffix(params);
  const [report, pickerOptions] = await Promise.all([
    loadOutstandingBalancesReport(prisma, context.scope, {
      officeId: params.officeId,
      loanOfficerId: params.loanOfficerId,
      currencyCode: params.currencyCode,
    }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const currencyOptions = [...new Set(report.rows.map((row) => row.currencyCode))].sort();
  const apiHref = `/api/reports/operations/outstanding-balances${query}`;
  const exportHref = `${apiHref}${query ? "&" : "?"}format=csv`;

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "Outstanding Balances (OLB)" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Operations report</p>
          <h1>Outstanding balances (OLB)</h1>
          <p>Current outstanding principal, interest, fees, and penalties for every active or in-arrears loan.</p>
        </div>
        <ReportPicker current="/reports/operations/outstanding-balances" options={pickerOptions} />
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

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Filters</h2>
            <p>Common ops run: slice OLB by office, officer, or currency.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Portfolio filters</legend>
            <div className="form-row three">
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
              <label>
                Currency
                <select defaultValue={params.currencyCode ?? ""} name="currencyCode">
                  <option value="">All currencies</option>
                  {currencyOptions.map((currencyCode) => (
                    <option key={currencyCode} value={currencyCode}>
                      {currencyCode}
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
            <Link className="secondary-action" href="/reports/operations/outstanding-balances">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Outstanding loan balances</h2>
            <p>{report.rows.length.toLocaleString()} loan account(s) with positive outstanding balances</p>
          </div>
          <Wallet size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <Wallet size={28} />
            <strong>No balances match these filters</strong>
            <p>Try clearing filters or check another office or officer.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>Loan account</th>
                  <th>Office</th>
                  <th>Officer</th>
                  <th>Status</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Fees</th>
                  <th>Penalties</th>
                  <th>Total OLB</th>
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
                    <td>{row.officeName}</td>
                    <td>{row.loanOfficerName}</td>
                    <td>
                      <span className={`status ${loanStatusTone(row.status)}`}>
                        {formatLoanStatus(row.status)}
                      </span>
                    </td>
                    <td>{formatMinor(row.principalOutstandingMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.interestOutstandingMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.feesOutstandingMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.penaltiesOutstandingMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.totalOutstandingMinor, row.currencyCode)}</td>
                    <td>{row.disbursedOn ? formatReportDate(row.disbursedOn) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {report.totals.map((row) => (
                  <tr key={`total-${row.currencyCode}`}>
                    <th colSpan={5}>Grand total ({row.loanCount.toLocaleString()} loans)</th>
                    <th>{formatMinor(row.principalOutstandingMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.interestOutstandingMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.feesOutstandingMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.penaltiesOutstandingMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.totalOutstandingMinor, row.currencyCode)}</th>
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

function querySuffix(filters: { officeId?: string; loanOfficerId?: string; currencyCode?: string }) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.loanOfficerId) params.set("loanOfficerId", filters.loanOfficerId);
  if (filters.currencyCode) params.set("currencyCode", filters.currencyCode);
  const query = params.toString();
  return query ? `?${query}` : "";
}

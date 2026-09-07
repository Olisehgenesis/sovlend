import { HandCoins, Download } from "lucide-react";
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
  formatReportDate,
  loadCollectionsReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

export default async function CollectionsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; startDate?: string; endDate?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportCollectionsLog,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const query = querySuffix(params);
  const [report, pickerOptions] = await Promise.all([
    loadCollectionsReport(prisma, context.scope, {
      officeId: params.officeId,
      startDate: params.startDate,
      endDate: params.endDate,
    }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const apiHref = `/api/reports/operations/collections${query}`;
  const exportHref = `${apiHref}${query ? "&" : "?"}format=csv`;

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Operations" },
          { label: "Collections" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Operations report</p>
          <h1>Collections</h1>
          <p>Actual receipts ledger of every repayment posted, newest first, with a full principal/interest/fees/penalty breakdown.</p>
        </div>
        <ReportPicker current="/reports/operations/collections" options={pickerOptions} />
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
            <p>Narrow the collections ledger by date range or office.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Collections filters</legend>
            <div className="form-row">
              <label>
                Start date
                <input defaultValue={params.startDate ?? ""} name="startDate" type="date" />
              </label>
              <label>
                End date
                <input defaultValue={params.endDate ?? ""} name="endDate" type="date" />
              </label>
            </div>
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
            <Link className="secondary-action" href="/reports/operations/collections">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Collections ledger</h2>
            <p>{report.rows.length.toLocaleString()} repayment receipt(s)</p>
          </div>
          <HandCoins size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <HandCoins size={28} />
            <strong>No collections match these filters</strong>
            <p>Try widening the dates or removing the office filter.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Receipt</th>
                  <th>Borrower</th>
                  <th>Loan account</th>
                  <th>Office</th>
                  <th>Product</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Fees</th>
                  <th>Penalty</th>
                  <th>Others</th>
                  <th>Total receipt</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.transactionId}>
                    <td>{formatReportDate(row.businessDate)}</td>
                    <td className="mono">{row.receiptNumber ?? "—"}</td>
                    <td>
                      <strong>{row.borrowerName}</strong>
                      <Link aria-label={`Open loan ${row.accountNumber}`} className="row-link" href={`/loans/${row.loanId}`} />
                    </td>
                    <td className="mono">{row.accountNumber}</td>
                    <td>{row.officeName}</td>
                    <td>{row.productName}</td>
                    <td>{formatMinor(row.principalMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.interestMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.feesMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.penaltiesMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.othersMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.totalMinor, row.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {report.totals.map((row) => (
                  <tr key={`total-${row.currencyCode}`}>
                    <th colSpan={6}>Grand total ({row.transactionCount.toLocaleString()} receipts)</th>
                    <th>{formatMinor(row.principalMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.interestMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.feesMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.penaltiesMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.othersMinor, row.currencyCode)}</th>
                    <th>{formatMinor(row.totalMinor, row.currencyCode)}</th>
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

function querySuffix(filters: { officeId?: string; startDate?: string; endDate?: string }) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  const query = params.toString();
  return query ? `?${query}` : "";
}

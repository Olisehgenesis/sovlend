import { Download, ReceiptText } from "lucide-react";
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
import { isoDate, loadSavingsTransactionsReport } from "@/modules/reports/domain/savings-report";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";

export default async function SavingsTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; startDate?: string; endDate?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const context = await loadOperationsReportContext(
    prisma,
    session.user.id,
    permissions.reportSavingsTransactions,
    { includeReferenceData: true },
  );
  if (!context) redirect("/");
  if (!context.allowed) redirect("/reports");

  const params = await searchParams;
  const query = querySuffix(params);
  const [report, pickerOptions] = await Promise.all([
    loadSavingsTransactionsReport(prisma, context.scope, {
      officeId: params.officeId,
      startDate: params.startDate,
      endDate: params.endDate,
    }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const apiHref = `/api/reports/savings/transactions${query}`;
  const exportHref = `${apiHref}${query ? "&" : "?"}format=csv`;

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: "Savings" },
          { label: "Savings Transactions" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Savings report</p>
          <h1>Savings transactions</h1>
          <p>Ledger of deposits, withdrawals, and charges posted to savings accounts. Not part of iLend&apos;s canned reports — original to SovLend.</p>
        </div>
        <ReportPicker current="/reports/savings/transactions" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href="/reports">
            Reports
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Filters</h2>
            <p>Narrow the ledger by date range or office. Defaults to the current month.</p>
          </div>
        </div>
        <form className="entity-form compact-mapping" method="GET">
          <fieldset>
            <legend>Savings transaction filters</legend>
            <div className="form-row">
              <label>
                Start date
                <input defaultValue={params.startDate ?? isoDate(report.startDate)} name="startDate" type="date" />
              </label>
              <label>
                End date
                <input defaultValue={params.endDate ?? isoDate(report.endDate)} name="endDate" type="date" />
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
            <Link className="secondary-action" href="/reports/savings/transactions">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Transaction ledger</h2>
            <p>{report.rows.length.toLocaleString()} transaction(s)</p>
          </div>
          <ReceiptText size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <ReceiptText size={28} />
            <strong>No savings transactions match these filters</strong>
            <p>Try widening the dates or removing the office filter.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Savings Account No.</th>
                  <th>Office/Branch</th>
                  <th>Product</th>
                  <th>Transaction Type</th>
                  <th>Amount</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{isoDate(row.businessDate)}</td>
                    <td>
                      <strong>{row.ownerName}</strong>
                      <Link
                        aria-label={`Open savings account ${row.accountNumber}`}
                        className="row-link"
                        href={`/savings-accounts/${row.accountNumber}`}
                      />
                    </td>
                    <td className="mono">{row.accountNumber}</td>
                    <td>{row.officeName}</td>
                    <td>{row.productName}</td>
                    <td>{row.transactionType}</td>
                    <td className="mono">{formatMinor(row.amountMinor, row.currencyCode)}</td>
                    <td>{row.externalReference ?? "—"}</td>
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

function querySuffix(filters: { officeId?: string; startDate?: string; endDate?: string }) {
  const params = new URLSearchParams();
  if (filters.officeId) params.set("officeId", filters.officeId);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  const query = params.toString();
  return query ? `?${query}` : "";
}

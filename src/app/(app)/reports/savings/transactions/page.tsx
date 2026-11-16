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
import { loadOperationsReportContext } from "@/modules/reports/domain/operations-report";
import { isoDate, loadSavingsTransactionsReport } from "@/modules/reports/domain/savings-report";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";

export default async function SavingsTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; startDate?: string; endDate?: string; preset?: string }>;
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
  const preset = parseReportDatePreset(params.preset);
  const resolvedRange = preset ? resolveDatePreset(new Date(), preset) : null;
  const startDate = resolvedRange ? formatDateInputValue(resolvedRange.startDate) : params.startDate;
  const endDate = resolvedRange ? formatDateInputValue(resolvedRange.endDate) : params.endDate;
  const filterParams = { officeId: params.officeId, startDate, endDate };
  const query = querySuffix(filterParams);
  const [report, pickerOptions] = await Promise.all([
    loadSavingsTransactionsReport(prisma, context.scope, filterParams),
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
          <h1>Savings transactions</h1>
          <p>Deposits, withdrawals, and charges on savings accounts.</p>
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

      <section className="panel report-toolbar">
        <ReportDatePresetPills
          active={preset}
          pathname="/reports/savings/transactions"
          query={{ officeId: params.officeId }}
        />
        <form className="report-toolbar-form" method="GET">
          <label>
            From
            <input defaultValue={startDate ?? isoDate(report.startDate)} name="startDate" type="date" />
          </label>
          <label>
            To
            <input defaultValue={endDate ?? isoDate(report.endDate)} name="endDate" type="date" />
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
          <button className="primary" type="submit">
            Apply
          </button>
        </form>
      </section>

      <section className="panel loan-table">
        <div className="panel-heading">
          <div>
            <h2>Transaction ledger</h2>
            <p>{report.rows.length.toLocaleString()} transaction(s)</p>
          </div>
        </div>
        {report.rows.length === 0 ? (
          <p className="coa-section-empty">No transactions for this range.</p>
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

import { Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { REPORT_DATE_PRESETS, parseReportDatePreset } from "@/components/report-date-presets";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";
import {
  buildReportQueryString,
  formatDateInputValue,
  resolveDatePreset,
  type ReportDatePreset,
} from "@/modules/reports/domain/accounting-report";
import {
  formatReportDate,
  loadCollectionsReport,
  loadOperationsReportContext,
} from "@/modules/reports/domain/operations-report";

type CollectionsDatePreset = ReportDatePreset | "all_time";

function parseCollectionsPreset(value?: string | null): CollectionsDatePreset | null {
  if (value === "today" || value === "week" || value === "month" || value === "year" || value === "all_time") {
    return value;
  }
  return parseReportDatePreset(value) as CollectionsDatePreset | null;
}

export default async function CollectionsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ officeId?: string; startDate?: string; endDate?: string; preset?: string }>;
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
  const preset = parseCollectionsPreset(params.preset);
  const standardPreset = preset && preset !== "all_time" ? preset : parseReportDatePreset(params.preset);
  const resolvedRange =
    preset === "all_time"
      ? { startDate: null as Date | null, endDate: null as Date | null }
      : standardPreset
        ? resolveDatePreset(new Date(), standardPreset)
        : { startDate: null as Date | null, endDate: null as Date | null };
  const startDateValue =
    standardPreset
      ? formatDateInputValue(resolvedRange.startDate as Date)
      : params.startDate ?? "";
  const endDateValue =
    standardPreset
      ? formatDateInputValue(resolvedRange.endDate as Date)
      : params.endDate ?? "";
  const activePreset =
    preset ??
    (!params.startDate && !params.endDate ? ("all_time" as const) : null);
  const query = querySuffix({
    officeId: params.officeId,
    startDate: startDateValue || undefined,
    endDate: endDateValue || undefined,
  });
  const [report, pickerOptions] = await Promise.all([
    loadCollectionsReport(prisma, context.scope, {
      officeId: params.officeId,
      startDate: startDateValue || null,
      endDate: endDateValue || null,
    }),
    loadReportPickerOptions(prisma, session.user.id, context.scope.organizationId),
  ]);
  const exportHref = `/api/reports/operations/collections${query}${query ? "&" : "?"}format=csv`;
  const rangeLabel =
    report.startDate && report.endDate
      ? `${formatReportDate(report.startDate)} – ${formatReportDate(report.endDate)}`
      : "All time";

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
          <h1>Collections</h1>
          <p>
            Repayment receipts with principal, interest, fees, and penalty breakdown · {rangeLabel}
          </p>
        </div>
        <ReportPicker current="/reports/operations/collections" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
        </div>
      </header>

      {report.totals.length > 0 ? (
        <section className="loan-summary-metrics" aria-label="Collection totals">
          {report.totals.map((row) => (
            <article key={row.currencyCode}>
              <span>Total collected ({row.currencyCode})</span>
              <strong>{formatMinor(row.totalMinor, row.currencyCode)}</strong>
              <small>{row.transactionCount.toLocaleString()} receipts</small>
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel report-toolbar">
        <div className="quick-filters report-toolbar-presets">
          <span className="quick-filters-label">Range</span>
          <div className="quick-filters-pills">
            {REPORT_DATE_PRESETS.map((item) => (
              <Link
                className={`pill-link ${standardPreset === item.value ? "active" : ""}`}
                href={`/reports/operations/collections?${buildReportQueryString({
                  preset: item.value,
                  officeId: params.officeId,
                })}`}
                key={item.value}
              >
                {item.label}
              </Link>
            ))}
            <Link
              className={`pill-link ${activePreset === "all_time" ? "active" : ""}`}
              href={`/reports/operations/collections?${buildReportQueryString({
                preset: "all_time",
                officeId: params.officeId,
              })}`}
            >
              All time
            </Link>
          </div>
        </div>
        <form className="report-toolbar-form" method="GET">
          <label>
            From
            <input defaultValue={startDateValue} name="startDate" type="date" />
          </label>
          <label>
            To
            <input defaultValue={endDateValue} name="endDate" type="date" />
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
            <h2>Collections ledger</h2>
            <p>{report.rows.length.toLocaleString()} repayment receipt(s)</p>
          </div>
        </div>
        {report.rows.length === 0 ? (
          <p className="coa-section-empty">No collections for this range.</p>
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
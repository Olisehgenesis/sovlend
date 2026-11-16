import { Download, ReceiptText } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { parseReportDatePreset, ReportDatePresetPills } from "@/components/report-date-presets";
import { ReportPicker } from "@/components/report-picker";
import { formatDateInputValue, resolveDatePreset } from "@/modules/reports/domain/accounting-report";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { formatDisplayDate, formatDisplayDateTime, getFeeRevenueFilters, loadFeeRevenueReport } from "@/modules/reports/domain/insights-report";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";

export default async function FeeRevenueReportPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; preset?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportFeeRevenue,
  );
  if (!allowed) redirect("/reports");

  const params = await searchParams;
  const preset = parseReportDatePreset(params.preset);
  const filterSource = preset
    ? {
        ...params,
        startDate: formatDateInputValue(resolveDatePreset(new Date(), preset).startDate),
        endDate: formatDateInputValue(resolveDatePreset(new Date(), preset).endDate),
      }
    : params;
  const filters = getFeeRevenueFilters(filterSource);
  const [report, pickerOptions] = await Promise.all([
    loadFeeRevenueReport(prisma, scope, filters),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const query = querySuffix({ startDate: report.startDate, endDate: report.endDate });
  const exportHref = `/api/reports/insights/fee-revenue${query}${query ? "&" : "?"}format=csv`;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Insights", href: "/reports" }, { label: "Fee & charges revenue" }]} />
      <header className="directory-header">
        <div>
          <h1>Fee &amp; charges revenue report</h1>
          <p>{formatDisplayDate(filters.startDate)} to {formatDisplayDate(filters.endDate)} by charge due date</p>
        </div>
        <ReportPicker current="/reports/insights/fee-revenue" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href="/reports">All reports</Link>
          <Link className="secondary-action" href="/backoffice/products">Charge templates</Link>
        </div>
      </header>

      <section className="panel report-toolbar">
        <ReportDatePresetPills active={preset} pathname="/reports/insights/fee-revenue" />
        <form className="report-toolbar-form" method="get">
          <label>
            From
            <input defaultValue={report.startDate} name="startDate" type="date" />
          </label>
          <label>
            To
            <input defaultValue={report.endDate} name="endDate" type="date" />
          </label>
          <button className="primary" type="submit">
            Apply
          </button>
        </form>
      </section>

      {report.undated.chargeCount > 0 ? (
        <section className="readiness-banner attention">
          <div>
            <strong>Undated charges</strong>
            <span>{report.undated.chargeCount.toLocaleString()} charges have no due date and are excluded from the dated totals below.</span>
          </div>
          <div className="readiness-progress"><i style={{ width: "100%" }} /></div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Portfolio totals</h2>
            <p>Generated {formatDisplayDateTime(new Date(report.generatedAt))}</p>
          </div>
        </div>
        <dl className="detail-grid">
          <div><dt>Collected (PAID)</dt><dd>{formatMinor(report.totals.paidMinor, report.totals.currencyCode)}</dd></div>
          <div><dt>Outstanding (PENDING)</dt><dd>{formatMinor(report.totals.pendingMinor, report.totals.currencyCode)}</dd></div>
          <div><dt>Waived</dt><dd>{formatMinor(report.totals.waivedMinor, report.totals.currencyCode)}</dd></div>
          <div><dt>Dated charges in window</dt><dd>{report.totals.chargeCount.toLocaleString()}</dd></div>
          <div><dt>Undated imported charges</dt><dd>{report.undated.chargeCount.toLocaleString()}</dd></div>
          <div><dt>Undated collected value</dt><dd>{formatMinor(report.undated.totals.paidMinor, report.undated.totals.currencyCode)}</dd></div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Revenue by charge type</h2>
            <p>Summed by charge name and status</p>
          </div>
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <ReceiptText size={28} />
            <strong>No dated charges matched this window</strong>
            <p>No dated charges in this window.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Charge type</th>
                  <th>Collected</th>
                  <th>Outstanding</th>
                  <th>Waived</th>
                  <th>Total value</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.currencyCode}-${row.name}`}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>{row.currencyCode}</small>
                    </td>
                    <td>
                      <strong>{formatMinor(row.amounts.PAID, row.currencyCode)}</strong>
                      <small>{row.counts.PAID.toLocaleString()} charges</small>
                    </td>
                    <td>
                      <strong>{formatMinor(row.amounts.PENDING, row.currencyCode)}</strong>
                      <small>{row.counts.PENDING.toLocaleString()} charges</small>
                    </td>
                    <td>
                      <strong>{formatMinor(row.amounts.WAIVED, row.currencyCode)}</strong>
                      <small>{row.counts.WAIVED.toLocaleString()} charges</small>
                    </td>
                    <td>{formatMinor(row.totalMinor, row.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {report.undated.rows.length > 0 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Undated imported charges</h2>
              <p>These rows keep setup fees visible without distorting date-window reporting.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Charge type</th>
                  <th>Collected</th>
                  <th>Outstanding</th>
                  <th>Waived</th>
                </tr>
              </thead>
              <tbody>
                {report.undated.rows.map((row) => (
                  <tr key={`undated-${row.currencyCode}-${row.name}`}>
                    <td><strong>{row.name}</strong></td>
                    <td>{formatMinor(row.amounts.PAID, row.currencyCode)}</td>
                    <td>{formatMinor(row.amounts.PENDING, row.currencyCode)}</td>
                    <td>{formatMinor(row.amounts.WAIVED, row.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function querySuffix(filters: { startDate: string; endDate: string }) {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  const query = params.toString();
  return query ? `?${query}` : "";
}

import { Search } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatDisplayDateTime, getAuditTrailFilters, loadAuditTrailReport } from "@/modules/reports/domain/insights-report";

export default async function AuditTrailReportPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; actorId?: string; startDate?: string; endDate?: string; page?: string; pageSize?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportAuditTrail,
  );
  if (!allowed) redirect("/reports");

  const filters = getAuditTrailFilters(await searchParams);
  const report = await loadAuditTrailReport(prisma, scope, filters);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Insights", href: "/reports" }, { label: "Audit trail" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">SovLend-only insight</p>
          <h1>Audit trail report</h1>
          <p>{report.totalRows.toLocaleString()} events in scope · page {report.filters.page} of {report.totalPages}</p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/reports">All reports</Link>
          <Link className="secondary-action" href="/loans">Loans</Link>
        </div>
      </header>

      <section className="panel form-panel">
        <form className="entity-form compact-mapping" method="get">
          <fieldset>
            <legend>Search and filters</legend>
            <div className="form-row three">
              <label>
                Entity type
                <select defaultValue={report.filters.entityType} name="entityType">
                  <option value="">All entity types</option>
                  {report.options.entityTypes.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                Action
                <select defaultValue={report.filters.action} name="action">
                  <option value="">All actions</option>
                  {report.options.actions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                Actor
                <select defaultValue={report.filters.actorId} name="actorId">
                  <option value="">All users and system</option>
                  {report.options.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name} ({actor.count})</option>)}
                </select>
              </label>
            </div>
            <div className="form-row three">
              <label>
                Start date
                <input defaultValue={report.filters.startDate} name="startDate" type="date" />
              </label>
              <label>
                End date
                <input defaultValue={report.filters.endDate} name="endDate" type="date" />
              </label>
              <label>
                Page size
                <select defaultValue={String(report.filters.pageSize)} name="pageSize">
                  {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
            </div>
          </fieldset>
          <div className="form-actions"><button className="invest-button" type="submit"><Search size={16} /> Apply filters</button></div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Audit events</h2>
            <p>Generated {formatDisplayDateTime(new Date(report.generatedAt))}</p>
          </div>
          <Search size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <Search size={28} />
            <strong>No audit events matched</strong>
            <p>Try widening the date range or clearing one of the filters.</p>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Occurred</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Correlation</th>
                    <th>Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{formatDisplayDateTime(new Date(row.occurredAt))}</strong>
                        <small className="mono">{row.id}</small>
                      </td>
                      <td>
                        <strong>{row.actorName}</strong>
                        <small className="mono">{row.actorId ?? "SYSTEM"}</small>
                      </td>
                      <td>{row.action}</td>
                      <td>
                        <strong>{row.entityType}</strong>
                        <small className="mono">{row.entityId}</small>
                      </td>
                      <td className="mono">{row.correlationId}</td>
                      <td>
                        <details>
                          <summary>View JSON</summary>
                          <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{JSON.stringify(row.metadata, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="pagination" aria-label="Audit trail pages">
              <Link aria-disabled={report.filters.page <= 1} href={pageHref(report, Math.max(1, report.filters.page - 1))}>Previous</Link>
              <span>Page {report.filters.page} of {report.totalPages}</span>
              <Link aria-disabled={report.filters.page >= report.totalPages} href={pageHref(report, Math.min(report.totalPages, report.filters.page + 1))}>Next</Link>
            </nav>
          </>
        )}
      </section>
    </main>
  );
}

function pageHref(
  report: {
    filters: { action: string; entityType: string; actorId: string; startDate: string; endDate: string; pageSize: number };
  },
  page: number,
) {
  const params = new URLSearchParams();
  if (report.filters.entityType) params.set("entityType", report.filters.entityType);
  if (report.filters.action) params.set("action", report.filters.action);
  if (report.filters.actorId) params.set("actorId", report.filters.actorId);
  params.set("startDate", report.filters.startDate);
  params.set("endDate", report.filters.endDate);
  params.set("pageSize", String(report.filters.pageSize));
  params.set("page", String(page));
  return `/reports/insights/audit-trail?${params.toString()}`;
}

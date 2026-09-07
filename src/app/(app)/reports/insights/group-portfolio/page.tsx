import { Download, Network } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { formatDisplayDateTime, loadGroupPortfolioReport } from "@/modules/reports/domain/insights-report";
import { loadReportPickerOptions } from "@/modules/reports/report-catalog";

export default async function GroupPortfolioReportPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    session.user.id,
    scope.organizationId,
    permissions.reportGroupPortfolio,
  );
  if (!allowed) redirect("/reports");

  const [report, pickerOptions] = await Promise.all([
    loadGroupPortfolioReport(prisma, scope),
    loadReportPickerOptions(prisma, session.user.id, scope.organizationId),
  ]);
  const exportHref = "/api/reports/insights/group-portfolio?format=csv";

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Reports", href: "/reports" }, { label: "Insights", href: "/reports" }, { label: "Group portfolio" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">SovLend-only insight</p>
          <h1>Group portfolio report</h1>
          <p>
            {report.totals.groupCount.toLocaleString()} groups · {report.totals.memberCount.toLocaleString()} members · {formatMinor(report.totals.savingsBalanceMinor, report.totals.currencyCode)} in group-owned savings
          </p>
        </div>
        <ReportPicker current="/reports/insights/group-portfolio" options={pickerOptions} />
        <div className="header-actions">
          <a className="secondary-action" href={exportHref}>
            <Download size={16} /> Export CSV
          </a>
          <Link className="secondary-action" href="/reports">All reports</Link>
          <Link className="secondary-action" href="/groups">Groups</Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Portfolio by group</h2>
            <p>Generated {formatDisplayDateTime(new Date(report.generatedAt))}</p>
          </div>
          <Network size={19} />
        </div>
        {report.rows.length === 0 ? (
          <div className="empty-state">
            <Network size={28} />
            <strong>No groups in scope</strong>
            <p>Once group-owned savings or loans exist in your office scope, they will appear here.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Account</th>
                  <th>Officer</th>
                  <th>Members</th>
                  <th>Group savings</th>
                  <th>Group loan portfolio</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>{row.savingsAccountCount} savings account{row.savingsAccountCount === 1 ? "" : "s"} · {row.loanCount} direct loan{row.loanCount === 1 ? "" : "s"}</small>
                    </td>
                    <td className="mono">{row.accountNumber}</td>
                    <td>{row.officerName ?? "Unassigned"}</td>
                    <td>{row.memberCount.toLocaleString()}</td>
                    <td>
                      <strong>{formatMinor(row.savingsBalanceMinor, row.currencyCode)}</strong>
                      <small>{row.savingsAccountCount} owned account{row.savingsAccountCount === 1 ? "" : "s"}</small>
                    </td>
                    <td>
                      <strong>{formatMinor(row.loanPrincipalMinor, row.currencyCode)}</strong>
                      <small>
                        {row.activeLoanCount} active · {row.arrearsLoanCount} arrears · {row.closedLoanCount} closed{row.otherLoanCount ? ` · ${row.otherLoanCount} other` : ""}
                      </small>
                      <small>{formatMinor(row.outstandingPrincipalMinor, row.currencyCode)} outstanding principal</small>
                    </td>
                    <td><span className={`status ${row.status === "ACTIVE" ? "up-to-date" : "review"}`}>{row.status}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Grand total</strong></td>
                  <td>—</td>
                  <td>—</td>
                  <td><strong>{report.totals.memberCount.toLocaleString()}</strong></td>
                  <td><strong>{formatMinor(report.totals.savingsBalanceMinor, report.totals.currencyCode)}</strong></td>
                  <td>
                    <strong>{formatMinor(report.totals.loanPrincipalMinor, report.totals.currencyCode)}</strong>
                    <br />
                    <small>{report.totals.activeLoanCount} active · {report.totals.arrearsLoanCount} arrears · {report.totals.closedLoanCount} closed</small>
                  </td>
                  <td><strong>{report.totals.groupCount.toLocaleString()} groups</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

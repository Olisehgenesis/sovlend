import { Download, Table2 } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { flattenReportLinks, loadVisibleReportSections } from "@/modules/reports/report-catalog";

/**
 * Flat "All Reports" registry, mirroring iLend's `#/reports/all` master list: every canned
 * report the current user may open, in one sortable-by-eye table (Report name / Category /
 * Type / actions), instead of the card-grid grouping on the main /reports directory page.
 */
export default async function AllReportsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) redirect("/");

  const visibleSections = await loadVisibleReportSections(prisma, session.user.id, user.organizationId);
  const totalVisible = visibleSections.reduce((total, section) => total + section.reports.length, 0);
  const allowedHrefs = new Set(visibleSections.flatMap((section) => section.reports.map((report) => report.href)));
  const pickerOptions = flattenReportLinks().filter((report) => allowedHrefs.has(report.href));

  const rows = visibleSections.flatMap((section) =>
    section.reports.map((report) => ({
      ...report,
      sectionTitle: section.title,
      apiHref: `/api${report.href}`,
    })),
  );

  return (
    <main className="directory-page reports-all-page">
      <Breadcrumbs items={[{ href: "/reports", label: "Reports" }, { label: "All reports" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Master registry</p>
          <h1>All reports</h1>
          <p>Every canned report available to your permission group, in one list — report name, category, and type, just like the legacy reports registry.</p>
        </div>
        {totalVisible > 0 ? <ReportPicker current="" options={pickerOptions} /> : null}
      </header>

      {totalVisible === 0 ? (
        <section className="panel reports-empty-panel">
          <div className="empty-state">
            <Table2 size={28} />
            <strong>No reports available yet</strong>
            <p>Ask an administrator to assign one or more report permissions to your team role.</p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Report name</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((report) => (
                  <tr key={report.href}>
                    <td>
                      <Link href={report.href}>{report.title}</Link>
                      <Link aria-label={`Open ${report.title}`} className="row-link" href={report.href} />
                    </td>
                    <td>{report.sectionTitle}</td>
                    <td>{report.exportable === false ? "Client lookup" : "Table"}</td>
                    <td>{report.description}</td>
                    <td className="reports-all-actions">
                      <Link className="secondary-action" href={report.href}>
                        <Table2 size={14} /> Open
                      </Link>
                      {report.exportable === false ? null : (
                        <Link className="secondary-action" href={`${report.apiHref}?format=csv`}>
                          <Download size={14} /> CSV
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

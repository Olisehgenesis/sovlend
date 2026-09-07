import { Sparkles, Table2 } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ReportPicker } from "@/components/report-picker";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { flattenReportLinks, loadVisibleReportSections } from "@/modules/reports/report-catalog";

export default async function ReportsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) redirect("/");

  const visibleSections = await loadVisibleReportSections(prisma, session.user.id, user.organizationId);
  const totalVisible = visibleSections.reduce((total, section) => total + section.reports.length, 0);
  const allowedHrefs = new Set(visibleSections.flatMap((section) => section.reports.map((report) => report.href)));
  const pickerOptions = flattenReportLinks().filter((report) => allowedHrefs.has(report.href));

  return (
    <main className="directory-page reports-directory">
      <Breadcrumbs items={[{ label: "Reports" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Portfolio insight</p>
          <h1>Reports</h1>
          <p>Operational, risk, accounting, and compliance reports available to your current permission group.</p>
        </div>
        <div className="reports-header-actions">
          {totalVisible > 0 ? <ReportPicker current="" options={pickerOptions} /> : null}
          <Link className="secondary-action" href="/reports/all">
            <Table2 size={16} /> All reports
          </Link>
        </div>
      </header>

      {totalVisible === 0 ? (
        <section className="panel reports-empty-panel">
          <div className="empty-state">
            <Sparkles size={28} />
            <strong>No reports available yet</strong>
            <p>Ask an administrator to assign one or more report permissions to your team role.</p>
          </div>
        </section>
      ) : (
        <div className="reports-hub">
          {visibleSections.map((section) => {
            const Icon = section.icon;
            return (
              <section className="report-section" key={section.id}>
                <div className="report-section-header">
                  <div>
                    <p className="eyebrow">{section.eyebrow}</p>
                    <h2>{section.title}</h2>
                    <p>{section.description}</p>
                  </div>
                  <span className="report-section-badge">
                    <Icon size={17} />
                    {section.reports.length} report{section.reports.length === 1 ? "" : "s"}
                  </span>
                </div>
                {section.reports.length === 0 ? (
                  <article className="panel report-section-empty">
                    <div className="empty-state">
                      <Icon size={24} />
                      <strong>No {section.title.toLowerCase()} report permissions</strong>
                      <p>This section will fill in once an administrator grants access.</p>
                    </div>
                  </article>
                ) : (
                  <div className="report-card-grid">
                    {section.reports.map((report) => (
                      <Link className="report-card" href={report.href} key={report.href}>
                        <span className="report-card-eyebrow">{section.title}</span>
                        <strong>{report.title}</strong>
                        <p>{report.description}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

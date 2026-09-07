import type { LucideIcon } from "lucide-react";
import { BookOpenText, Briefcase, ShieldAlert, Sparkles } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

type ReportLink = Readonly<{
  href: string;
  permission: (typeof permissions)[keyof typeof permissions];
  title: string;
  description: string;
}>;

type ReportSection = Readonly<{
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  reports: readonly ReportLink[];
}>;

const reportSections: readonly ReportSection[] = [
  {
    id: "accounting",
    title: "Accounting",
    eyebrow: "Financial statements",
    description: "Ledger-backed statements for finance and treasury sign-off.",
    icon: BookOpenText,
    reports: [
      { href: "/reports/accounting/balance-sheet", permission: permissions.reportBalanceSheet, title: "Balance Sheet", description: "Statement of financial position across the organization." },
      { href: "/reports/accounting/income-statement", permission: permissions.reportIncomeStatement, title: "Income Statement", description: "Profit, loss, and period performance." },
      { href: "/reports/accounting/trial-balance", permission: permissions.reportTrialBalance, title: "Trial Balance", description: "Debits and credits by account before close." },
      { href: "/reports/accounting/general-ledger", permission: permissions.reportGeneralLedger, title: "General Ledger", description: "Detailed journal-backed account activity." },
      { href: "/reports/accounting/journal-reconciliation", permission: permissions.reportJournalReconciliation, title: "Journal Reconciliation", description: "Reconcile journal lines and posting integrity." },
    ],
  },
  {
    id: "risk",
    title: "Risk",
    eyebrow: "Portfolio quality",
    description: "Monitor arrears, provisioning, recoveries, and delinquency trends.",
    icon: ShieldAlert,
    reports: [
      { href: "/reports/risk/aging", permission: permissions.reportAging, title: "Aging", description: "Buckets past-due loans by delinquency age." },
      { href: "/reports/risk/non-performing-loans", permission: permissions.reportNonPerformingLoans, title: "Non-Performing Loans", description: "Track NPL exposure and overdue accounts." },
      { href: "/reports/risk/provisioning", permission: permissions.reportProvisioning, title: "Provisioning", description: "Estimate loan-loss reserves from current risk bands." },
      { href: "/reports/risk/recoveries", permission: permissions.reportRecoveries, title: "Recoveries", description: "Review collections on written-off loans." },
      { href: "/reports/risk/par-rollrate", permission: permissions.reportParRollRate, title: "PAR Roll-rate", description: "Follow vintage migration across arrears bands." },
    ],
  },
  {
    id: "operations",
    title: "Operations",
    eyebrow: "Branch execution",
    description: "Daily workload, staffing gaps, and branch-level lending visibility.",
    icon: Briefcase,
    reports: [
      { href: "/reports/operations/collection-by-officer", permission: permissions.reportCollectionByOfficer, title: "Collection by Officer", description: "Expected collections grouped by responsible officer." },
      { href: "/reports/operations/unassigned-loans", permission: permissions.reportUnassignedLoans, title: "Unassigned Loans", description: "Find active loans missing an assigned officer." },
      { href: "/reports/operations/branch-portfolio", permission: permissions.reportBranchPortfolio, title: "Branch Portfolio", description: "Portfolio totals by office and branch." },
      { href: "/reports/operations/disbursal-cohort", permission: permissions.reportDisbursalCohort, title: "Disbursal Cohort", description: "Compare loan cohorts by disbursal period." },
      { href: "/reports/operations/outstanding-balances", permission: permissions.reportOutstandingBalances, title: "Outstanding Balances", description: "Current OLB across active loan accounts." },
      { href: "/reports/operations/client-listing", permission: permissions.reportClientListing, title: "Client Listing", description: "Exportable roster of clients in scope." },
    ],
  },
  {
    id: "insights",
    title: "Insights",
    eyebrow: "Cross-portfolio views",
    description: "Relationship, revenue, compliance, and audit visibility in one place.",
    icon: Sparkles,
    reports: [
      { href: "/reports/insights/group-portfolio", permission: permissions.reportGroupPortfolio, title: "Group Portfolio", description: "View group lending and savings concentrations." },
      { href: "/reports/insights/guarantor-exposure", permission: permissions.reportGuarantorExposure, title: "Guarantor Exposure", description: "Review guarantor concentration across active loans." },
      { href: "/reports/insights/fee-revenue", permission: permissions.reportFeeRevenue, title: "Fee Revenue", description: "Track income from fees and charges." },
      { href: "/reports/insights/document-completeness", permission: permissions.reportDocumentCompleteness, title: "Document Completeness", description: "Check KYC and required document coverage." },
      { href: "/reports/insights/audit-trail", permission: permissions.reportAuditTrail, title: "Audit Trail", description: "Search immutable operational events." },
    ],
  },
];

export default async function ReportsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) redirect("/");

  const authorization = new AuthorizationService(prisma);
  const allowedChecks = await Promise.all(
    reportSections.flatMap((section) => section.reports.map(async (report) => [
      report.permission,
      await authorization.isAllowedForOrganization(session.user.id, user.organizationId as string, report.permission),
    ] as const)),
  );
  const allowedByPermission = new Map(allowedChecks);
  const visibleSections = reportSections.map((section) => ({
    ...section,
    reports: section.reports.filter((report) => allowedByPermission.get(report.permission)),
  }));
  const totalVisible = visibleSections.reduce((total, section) => total + section.reports.length, 0);

  return (
    <main className="directory-page reports-directory">
      <Breadcrumbs items={[{ label: "Reports" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Portfolio insight</p>
          <h1>Reports</h1>
          <p>Operational, risk, accounting, and compliance reports available to your current permission group.</p>
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

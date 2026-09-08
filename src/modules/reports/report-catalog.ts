import type { LucideIcon } from "lucide-react";
import { BookOpenText, Briefcase, PiggyBank, ShieldAlert, Sparkles } from "lucide-react";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import type { prisma as prismaClient } from "@/lib/prisma";

export type ReportLink = Readonly<{
  href: string;
  permission: (typeof permissions)[keyof typeof permissions];
  title: string;
  description: string;
}>;

export type ReportSection = Readonly<{
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  reports: readonly ReportLink[];
}>;

/**
 * Single source of truth for every report: which page it lives on, which
 * permission gates it, and which category it belongs to. Used to render both
 * the /reports directory grid and the "jump to report" dropdown that appears
 * on every report page (mirroring iLend's Reports > category > report flow).
 */
export const reportSections: readonly ReportSection[] = [
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
      { href: "/reports/risk/arrears", permission: permissions.reportArrears, title: "Arrears Report", description: "Component-level breakdown of amounts overdue on loans in arrears." },
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
      { href: "/reports/operations/active-loans", permission: permissions.reportActiveLoans, title: "Active Loans", description: "Register of all currently active and in-arrears loan accounts." },
      { href: "/reports/operations/collection-by-officer", permission: permissions.reportCollectionByOfficer, title: "Collection by Officer", description: "Expected collections grouped by responsible officer." },
      { href: "/reports/operations/collections", permission: permissions.reportCollectionsLog, title: "Collections", description: "Actual receipts ledger of every repayment posted, with principal/interest/fees/penalty breakdown." },
      { href: "/reports/operations/unassigned-loans", permission: permissions.reportUnassignedLoans, title: "Unassigned Loans", description: "Find active loans missing an assigned officer." },
      { href: "/reports/operations/branch-portfolio", permission: permissions.reportBranchPortfolio, title: "Branch Portfolio", description: "Portfolio totals by office and branch." },
      { href: "/reports/operations/disbursal-cohort", permission: permissions.reportDisbursalCohort, title: "Disbursal Cohort", description: "Compare loan cohorts by disbursal period." },
      { href: "/reports/operations/disbursal-report", permission: permissions.reportDisbursalLedger, title: "Disbursal Report", description: "Chronological ledger of individual loan disbursements." },
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
  {
    id: "savings",
    title: "Savings",
    eyebrow: "Deposit operations",
    description: "Savings account register, transaction ledger, and officer-level balances — not covered by any iLend canned report.",
    icon: PiggyBank,
    reports: [
      { href: "/reports/savings/account-listing", permission: permissions.reportSavingsAccountListing, title: "Savings Account Listing", description: "Exportable register of every savings account and its current balance." },
      { href: "/reports/savings/transactions", permission: permissions.reportSavingsTransactions, title: "Savings Transactions", description: "Ledger of deposits, withdrawals, and charges posted to savings accounts." },
      { href: "/reports/savings/portfolio-by-officer", permission: permissions.reportSavingsPortfolioByOfficer, title: "Savings Portfolio by Officer", description: "Total and average savings balances grouped by savings officer." },
    ],
  },
];

export function flattenReportLinks(sections: readonly ReportSection[] = reportSections) {
  return sections.flatMap((section) =>
    section.reports.map((report) => ({ ...report, sectionId: section.id, sectionTitle: section.title })),
  );
}

/** Permission-filtered report list for the "jump to report" dropdown, shared by every report page. */
export async function loadReportPickerOptions(
  prisma: typeof prismaClient,
  userId: string,
  organizationId: string,
) {
  const authorization = new AuthorizationService(prisma);
  const flat = flattenReportLinks();
  const allowedChecks = await Promise.all(
    flat.map((report) => authorization.isAllowedForOrganization(userId, organizationId, report.permission)),
  );
  return flat.filter((_, index) => allowedChecks[index]);
}

/**
 * Permission-filtered report sections (each with its `.reports` array trimmed to what the
 * current user may open). Shared by the /reports directory page, the /reports/all registry
 * table, and the top-nav + sidebar "Reports" dropdowns so every surface stays in sync with a
 * single source of truth.
 */
export async function loadVisibleReportSections(
  prisma: typeof prismaClient,
  userId: string,
  organizationId: string,
): Promise<readonly ReportSection[]> {
  const authorization = new AuthorizationService(prisma);
  const allowedChecks = await Promise.all(
    reportSections.flatMap((section) =>
      section.reports.map(
        async (report) => [report.permission, await authorization.isAllowedForOrganization(userId, organizationId, report.permission)] as const,
      ),
    ),
  );
  const allowedByPermission = new Map(allowedChecks);
  return reportSections.map((section) => ({
    ...section,
    reports: section.reports.filter((report) => allowedByPermission.get(report.permission)),
  }));
}

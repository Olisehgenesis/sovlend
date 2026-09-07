export const permissions = {
  clientView: "CLIENT_VIEW",
  clientManage: "CLIENT_MANAGE",
  loanView: "LOAN_VIEW",
  loanApply: "LOAN_APPLICATION_CREATE",
  loanApprove: "LOAN_APPROVE",
  loanDisburse: "LOAN_DISBURSE",
  loanRepayment: "LOAN_REPAYMENT_RECORD",
  loanClose: "LOAN_CLOSE",
  loanWriteOff: "LOAN_WRITE_OFF",
  loanReverse: "LOAN_REVERSE",
  savingsView: "SAVINGS_VIEW",
  savingsTransact: "SAVINGS_TRANSACT",
  savingsApprove: "SAVINGS_APPROVE",
  treasuryView: "TREASURY_VIEW",
  treasuryPropose: "TREASURY_PROPOSE",
  treasuryApprove: "TREASURY_APPROVE",
  ledgerView: "LEDGER_VIEW",
  ledgerPost: "LEDGER_POST",
  reportView: "REPORT_VIEW",
  userManage: "USER_MANAGE",
  permissionManage: "PERMISSION_MANAGE",
  auditView: "AUDIT_VIEW",
  productManage: "PRODUCT_MANAGE",

  // Per-report permissions. REPORT_VIEW (above) gates access to the Reports section as a
  // whole; each of these gates one specific report so an admin can grant/revoke individual
  // reports per role without exposing every report to everyone with REPORT_VIEW.
  reportBalanceSheet: "REPORT_VIEW_BALANCE_SHEET",
  reportIncomeStatement: "REPORT_VIEW_INCOME_STATEMENT",
  reportTrialBalance: "REPORT_VIEW_TRIAL_BALANCE",
  reportGeneralLedger: "REPORT_VIEW_GENERAL_LEDGER",
  reportJournalReconciliation: "REPORT_VIEW_JOURNAL_RECONCILIATION",

  reportAging: "REPORT_VIEW_AGING",
  reportNonPerformingLoans: "REPORT_VIEW_NON_PERFORMING_LOANS",
  reportProvisioning: "REPORT_VIEW_PROVISIONING",
  reportRecoveries: "REPORT_VIEW_RECOVERIES",
  reportParRollRate: "REPORT_VIEW_PAR_ROLLRATE",

  reportCollectionByOfficer: "REPORT_VIEW_COLLECTION_BY_OFFICER",
  reportUnassignedLoans: "REPORT_VIEW_UNASSIGNED_LOANS",
  reportBranchPortfolio: "REPORT_VIEW_BRANCH_PORTFOLIO",
  reportDisbursalCohort: "REPORT_VIEW_DISBURSAL_COHORT",
  reportOutstandingBalances: "REPORT_VIEW_OUTSTANDING_BALANCES",
  reportClientListing: "REPORT_VIEW_CLIENT_LISTING",

  reportGroupPortfolio: "REPORT_VIEW_GROUP_PORTFOLIO",
  reportGuarantorExposure: "REPORT_VIEW_GUARANTOR_EXPOSURE",
  reportFeeRevenue: "REPORT_VIEW_FEE_REVENUE",
  reportDocumentCompleteness: "REPORT_VIEW_DOCUMENT_COMPLETENESS",
  reportAuditTrail: "REPORT_VIEW_AUDIT_TRAIL",
} as const;

export type PermissionCode = (typeof permissions)[keyof typeof permissions];

const accountingReportPermissions = [permissions.reportBalanceSheet, permissions.reportIncomeStatement, permissions.reportTrialBalance, permissions.reportGeneralLedger, permissions.reportJournalReconciliation] as const;
const riskReportPermissions = [permissions.reportAging, permissions.reportNonPerformingLoans, permissions.reportProvisioning, permissions.reportRecoveries, permissions.reportParRollRate] as const;
const operationsReportPermissions = [permissions.reportCollectionByOfficer, permissions.reportUnassignedLoans, permissions.reportBranchPortfolio, permissions.reportDisbursalCohort, permissions.reportOutstandingBalances, permissions.reportClientListing] as const;
const insightsReportPermissions = [permissions.reportGroupPortfolio, permissions.reportGuarantorExposure, permissions.reportFeeRevenue, permissions.reportDocumentCompleteness, permissions.reportAuditTrail] as const;

export const reportPermissionGroups = {
  accounting: accountingReportPermissions,
  risk: riskReportPermissions,
  operations: operationsReportPermissions,
  insights: insightsReportPermissions,
} as const;

export const allReportPermissions = [...accountingReportPermissions, ...riskReportPermissions, ...operationsReportPermissions, ...insightsReportPermissions] as const;

export const defaultPermissionGroups: Record<string, readonly PermissionCode[]> = {
  "General Manager": Object.values(permissions).filter((code) => code !== permissions.treasuryApprove),
  "Branch Manager": [
    permissions.clientView, permissions.clientManage, permissions.loanView, permissions.loanApply, permissions.loanApprove, permissions.loanDisburse, permissions.loanRepayment, permissions.loanClose, permissions.loanReverse, permissions.savingsView, permissions.savingsTransact, permissions.savingsApprove, permissions.ledgerView, permissions.reportView, permissions.productManage,
    ...riskReportPermissions, ...operationsReportPermissions, ...insightsReportPermissions,
  ],
  Teller: [permissions.clientView, permissions.loanView, permissions.loanRepayment, permissions.savingsView, permissions.savingsTransact],
  "Loan Officer": [permissions.clientView, permissions.clientManage, permissions.loanView, permissions.loanApply, permissions.reportView, permissions.reportCollectionByOfficer, permissions.reportAging, permissions.reportUnassignedLoans, permissions.reportClientListing],
  "Treasury Signer": [permissions.treasuryView, permissions.treasuryApprove, permissions.ledgerView, permissions.auditView, ...accountingReportPermissions, permissions.reportOutstandingBalances, permissions.reportProvisioning],
  Auditor: [permissions.clientView, permissions.loanView, permissions.savingsView, permissions.treasuryView, permissions.ledgerView, permissions.reportView, permissions.auditView, ...allReportPermissions],
  Investor: [permissions.treasuryView],
};

export type PermissionAssignment = Readonly<{
  permissionCodes: readonly string[];
  organizationId: string;
  scope: "ORGANIZATION" | "OFFICE" | "OWN";
  officeId: string | null;
  includeChildOffices: boolean;
  approvalLimitMinor: bigint | null;
  approvalCurrencyCode: string | null;
  validFrom: Date;
  validUntil: Date | null;
}>;

export type PermissionContext = Readonly<{
  permission: PermissionCode;
  organizationId: string;
  officeId?: string | null;
  officeAncestorIds?: readonly string[];
  ownerUserId?: string | null;
  actorUserId: string;
  amountMinor?: bigint;
  currencyCode?: string;
  now?: Date;
}>;

export function hasPermission(assignments: readonly PermissionAssignment[], context: PermissionContext): boolean {
  const now = context.now ?? new Date();
  return assignments.some((assignment) => {
    if (!assignment.permissionCodes.includes(context.permission)) return false;
    if (assignment.organizationId !== context.organizationId) return false;
    if (assignment.validFrom > now || (assignment.validUntil && assignment.validUntil <= now)) return false;
    if (!scopeMatches(assignment, context)) return false;
    if (context.amountMinor !== undefined && assignment.approvalLimitMinor !== null) {
      if (assignment.approvalCurrencyCode !== context.currencyCode) return false;
      if (context.amountMinor > assignment.approvalLimitMinor) return false;
    }
    return true;
  });
}

function scopeMatches(assignment: PermissionAssignment, context: PermissionContext) {
  if (assignment.scope === "ORGANIZATION") return true;
  if (assignment.scope === "OWN") return context.ownerUserId === context.actorUserId;
  if (!assignment.officeId || !context.officeId) return false;
  if (assignment.officeId === context.officeId) return true;
  return assignment.includeChildOffices && (context.officeAncestorIds ?? []).includes(assignment.officeId);
}
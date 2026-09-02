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
} as const;

export type PermissionCode = (typeof permissions)[keyof typeof permissions];

export const defaultPermissionGroups: Record<string, readonly PermissionCode[]> = {
  "General Manager": Object.values(permissions).filter((code) => code !== permissions.treasuryApprove),
  "Branch Manager": [permissions.clientView, permissions.clientManage, permissions.loanView, permissions.loanApply, permissions.loanApprove, permissions.loanDisburse, permissions.loanRepayment, permissions.loanClose, permissions.savingsView, permissions.savingsTransact, permissions.savingsApprove, permissions.ledgerView, permissions.reportView, permissions.productManage],
  Teller: [permissions.clientView, permissions.loanView, permissions.loanRepayment, permissions.savingsView, permissions.savingsTransact],
  "Loan Officer": [permissions.clientView, permissions.clientManage, permissions.loanView, permissions.loanApply, permissions.reportView],
  "Treasury Signer": [permissions.treasuryView, permissions.treasuryApprove, permissions.ledgerView, permissions.auditView],
  Auditor: [permissions.clientView, permissions.loanView, permissions.savingsView, permissions.treasuryView, permissions.ledgerView, permissions.reportView, permissions.auditView],
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
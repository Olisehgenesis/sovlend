/**
 * Historical `LoanTransaction` rows migrated from Fineract store the *raw* Fineract type code
 * (e.g. `loanTransactionType.disbursement`) rather than the short canonical string the live app
 * writes for new transactions (`DISBURSEMENT`). Those rows are protected by an append-only
 * database trigger and can never be normalized in place, so any exact-match `transactionType`
 * filter must match both forms to see historical data. Use `transactionTypeVariants()` wherever
 * code currently does `transactionType: "DISBURSEMENT"` and needs `transactionType: { in: [...] }`
 * instead.
 */
const LEGACY_VARIANTS: Record<string, string[]> = {
  DISBURSEMENT: ["loanTransactionType.disbursement"],
  REPAYMENT: ["loanTransactionType.repayment"],
  REPAYMENT_REVERSAL: ["loanTransactionType.repayment.reversal"],
  RECOVERY_REPAYMENT: ["loanTransactionType.recoveryRepayment"],
  WRITE_OFF: ["loanTransactionType.writeOff"],
  REPAYMENT_AT_DISBURSEMENT: ["loanTransactionType.repaymentAtDisbursement"],
  INTEREST_WAIVER: ["loanTransactionType.waiver"],
  CHARGE_WAIVER: ["loanTransactionType.waiveCharges"],
  ACCRUAL: ["loanTransactionType.accrual"],
};

export function transactionTypeVariants(canonical: string): string[] {
  return [canonical, ...(LEGACY_VARIANTS[canonical] ?? [])];
}

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

// Both the raw Fineract-style code (`loanTransactionType.repaymentAtDisbursement`) and the
// canonical string new transactions use (`REPAYMENT_AT_DISBURSEMENT`) must render as one
// human-readable label (e.g. "Repayment At Disbursement") — operators should never see either
// raw form in the UI.
export function transactionTypeLabel(type: string) {
  const withoutPrefix = type.startsWith("loanTransactionType.")
    ? type.slice("loanTransactionType.".length)
    : type;
  const words = withoutPrefix
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export type LoanTodayTransactionKind = "REPAYMENT" | "DISBURSEMENT";

/**
 * `collected-today` and `disbursed-today` are the same page shape — same query shape,
 * table columns and layout — differing only in which transaction-type variant they query
 * and their copy. Isolating that difference as a pure, independently-testable function
 * keeps the distinguishing behavior of each variant covered without needing to render
 * the (server-only, Prisma/auth-backed) page component in a test.
 */
export function getLoanTodayTransactionsConfig(kind: LoanTodayTransactionKind) {
  if (kind === "REPAYMENT") {
    return {
      breadcrumbLabel: "Collected today",
      eyebrow: "Daily collections",
      heading: "Repayments collected today",
      summaryNoun: "repayment transactions",
      summaryVerb: "recorded",
      sectionHeading: "Repayment transactions",
      sectionDescription: "Cash and channel receipts posted to loan accounts in your current office scope",
      emptyTitle: "No repayments collected today",
      emptyDescription: "No repayment transactions have been recorded in your current office scope today.",
    } as const;
  }
  return {
    breadcrumbLabel: "Disbursed today",
    eyebrow: "Daily disbursements",
    heading: "Loans disbursed today",
    summaryNoun: "disbursement transactions",
    summaryVerb: "released",
    sectionHeading: "Disbursement transactions",
    sectionDescription: "Principal released to borrowers in your current office scope today",
    emptyTitle: "No loans disbursed today",
    emptyDescription: "No disbursement transactions have been recorded in your current office scope today.",
  } as const;
}

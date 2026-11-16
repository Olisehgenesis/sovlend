-- Officer-scoped lists and reports filter loans by the assigned officer and status.
CREATE INDEX "Loan_loanOfficerId_status_idx" ON "Loan"("loanOfficerId", "status");

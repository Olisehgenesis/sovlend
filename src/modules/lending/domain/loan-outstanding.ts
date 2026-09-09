/**
 * Single source of truth for computing an installment's or loan's true outstanding
 * balance. Mirrors Fineract's accounting identity: due = paid + waived + writtenOff + outstanding.
 *
 * Historically this codebase computed outstanding as `due - paid` everywhere, which is
 * correct for open loans but silently overstates the balance on WRITTEN_OFF loans: iLend
 * zeroes out a written-off loan's outstanding at the loan level (Loan.summary.*WrittenOff),
 * not by reducing individual installment rows. Always route outstanding calculations
 * through these helpers instead of re-deriving `due - paid` inline.
 */

export type InstallmentAmounts = {
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  feesDueMinor: bigint;
  penaltiesDueMinor: bigint;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  feesPaidMinor: bigint;
  penaltiesPaidMinor: bigint;
  principalWaivedMinor?: bigint;
  interestWaivedMinor?: bigint;
  feesWaivedMinor?: bigint;
  penaltiesWaivedMinor?: bigint;
  // Monitoring fee is tracked in its own due/paid/waived columns going forward (see Problem 2 in
  // the accounting audit) so it can be posted to, and reported against, a distinct ledger income
  // account even when its rate coincides with the interest rate. Optional and defaulted to 0 so
  // every existing caller -- and every historical installment, which never populates these and
  // instead carries its monitoring fee inside feesDueMinor/feesPaidMinor -- keeps behaving
  // exactly as it does today.
  monitoringFeeDueMinor?: bigint;
  monitoringFeePaidMinor?: bigint;
  monitoringFeeWaivedMinor?: bigint;
};

export type LoanWriteOffAmounts = {
  principalWrittenOffMinor: bigint;
  interestWrittenOffMinor: bigint;
  feesWrittenOffMinor: bigint;
  penaltiesWrittenOffMinor: bigint;
};

function clamp(amount: bigint): bigint {
  return amount > 0n ? amount : 0n;
}

export function installmentDueMinor(installment: InstallmentAmounts): bigint {
  return (
    installment.principalDueMinor +
    installment.interestDueMinor +
    installment.feesDueMinor +
    installment.penaltiesDueMinor +
    (installment.monitoringFeeDueMinor ?? 0n)
  );
}

export function installmentPaidMinor(installment: InstallmentAmounts): bigint {
  return (
    installment.principalPaidMinor +
    installment.interestPaidMinor +
    installment.feesPaidMinor +
    installment.penaltiesPaidMinor +
    (installment.monitoringFeePaidMinor ?? 0n)
  );
}

export function installmentWaivedMinor(installment: InstallmentAmounts): bigint {
  return (
    (installment.principalWaivedMinor ?? 0n) +
    (installment.interestWaivedMinor ?? 0n) +
    (installment.feesWaivedMinor ?? 0n) +
    (installment.penaltiesWaivedMinor ?? 0n) +
    (installment.monitoringFeeWaivedMinor ?? 0n)
  );
}

/** Outstanding for a single installment row, ignoring any loan-level write-off. */
export function installmentOutstandingMinor(installment: InstallmentAmounts): bigint {
  return clamp(installmentDueMinor(installment) - installmentPaidMinor(installment) - installmentWaivedMinor(installment));
}

export function loanWrittenOffMinor(loan: LoanWriteOffAmounts): bigint {
  return loan.principalWrittenOffMinor + loan.interestWrittenOffMinor + loan.feesWrittenOffMinor + loan.penaltiesWrittenOffMinor;
}

/**
 * True outstanding balance for a loan: sum of installment due-paid-waived, minus whatever
 * was written off at the loan level. This is the number that should be shown anywhere the
 * app displays "outstanding" for a specific loan (loan detail, portal, list rows, reports).
 */
export function loanOutstandingMinor(installments: readonly InstallmentAmounts[], loan: LoanWriteOffAmounts): bigint {
  const dueMinor = installments.reduce((sum, item) => sum + installmentDueMinor(item), 0n);
  const paidMinor = installments.reduce((sum, item) => sum + installmentPaidMinor(item), 0n);
  const waivedMinor = installments.reduce((sum, item) => sum + installmentWaivedMinor(item), 0n);
  return clamp(dueMinor - paidMinor - waivedMinor - loanWrittenOffMinor(loan));
}

/**
 * Whether a loan status means the loan is settled and should never surface an "overdue"
 * or outstanding balance in reports/reminders, regardless of what raw due-paid arithmetic
 * says. Fineract records the write-off at the loan level, not per-installment, so an
 * individual installment's due-paid math can still look "overdue" after write-off unless
 * callers explicitly check the loan status first.
 */
export function isLoanSettledStatus(status: string): boolean {
  return status === "WRITTEN_OFF" || status === "CLOSED";
}

export type PrincipalAmounts = {
  principalDueMinor: bigint;
  principalPaidMinor: bigint;
  principalWaivedMinor?: bigint;
};

/**
 * Principal-only counterpart to `loanOutstandingMinor`, used for Portfolio at Risk (PAR),
 * which is defined on the principal balance alone — not the total due/outstanding across
 * principal + interest + fees + penalties. Same due-paid-waived-writtenOff identity, same
 * "sum first, clamp once at the loan level" rule (never clamp per installment first).
 */
export function principalOutstandingMinor(installments: readonly PrincipalAmounts[], principalWrittenOffMinor: bigint): bigint {
  const dueMinor = installments.reduce((sum, item) => sum + item.principalDueMinor, 0n);
  const paidMinor = installments.reduce((sum, item) => sum + item.principalPaidMinor, 0n);
  const waivedMinor = installments.reduce((sum, item) => sum + (item.principalWaivedMinor ?? 0n), 0n);
  return clamp(dueMinor - paidMinor - waivedMinor - principalWrittenOffMinor);
}

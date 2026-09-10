const DAY_IN_MS = 24 * 60 * 60 * 1_000;

/**
 * Determines whether an installment's remaining interest should be recognized as accrued income
 * (Dr Interest Receivable / Cr Interest Income) even though it has not yet been collected in
 * cash. Mirrors isInstallmentPenaltyAssessable's one-time, bounded-window design exactly:
 * interest becomes accrual-eligible once its due date has passed (interest is fully earned by
 * the schedule's due date) and stays eligible only for a small resilience window afterward, so a
 * scheduler outage never causes a flood of very old, retroactively-recognized income once it
 * resumes. Never re-accrues an installment that already carries an interestAccruedOn date.
 */
export function isInstallmentInterestAccruable(input: {
  dueOn: Date;
  today: Date;
  interestAccruedOn: Date | null;
  lookbackBufferDays?: number;
}): boolean {
  if (input.interestAccruedOn) return false;

  const lookbackBufferDays = input.lookbackBufferDays ?? 3;
  if (!Number.isInteger(lookbackBufferDays) || lookbackBufferDays < 0) {
    throw new Error("lookbackBufferDays must be a non-negative integer");
  }

  const daysSinceDue = diffUtcDays(input.today, input.dueOn);
  return daysSinceDue >= 0 && daysSinceDue <= lookbackBufferDays;
}

/** The remaining interest on an installment that has not yet been collected or waived -- the
 * amount an accrual entry recognizes as earned-but-uncollected income. */
export function computeAccruableInterestMinor(installment: {
  interestDueMinor: bigint;
  interestPaidMinor: bigint;
  interestWaivedMinor?: bigint;
}): bigint {
  const outstanding = installment.interestDueMinor - installment.interestPaidMinor - (installment.interestWaivedMinor ?? 0n);
  return outstanding > 0n ? outstanding : 0n;
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function diffUtcDays(left: Date, right: Date): number {
  return Math.floor((toUtcDay(left).getTime() - toUtcDay(right).getTime()) / DAY_IN_MS);
}

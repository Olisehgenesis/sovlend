import {
  installmentDueMinor,
  installmentPaidMinor,
  installmentWaivedMinor,
  type InstallmentAmounts,
} from "./loan-outstanding";

export type InstallmentPaymentEvidence = Readonly<{
  amountMinor: bigint;
  businessDate: Date;
}>;

export type InstallmentPaymentTiming =
  | "PAID_EARLY"
  | "PAID_ON_TIME"
  | "PAID_LATE"
  | "PART_PAID"
  | "PART_PAID_LATE"
  | "OVERDUE"
  | "UPCOMING"
  | "WAIVED"
  | "TIMING_UNAVAILABLE";

export type InstallmentDueVsPaid = Readonly<{
  timing: InstallmentPaymentTiming;
  /**
   * Business date of the most recent non-cancelled payment against the installment. Null when
   * no payment evidence exists (nothing paid yet, or settled purely through waivers/charge
   * payments that never created installment allocations).
   */
  paidOn: Date | null;
  /**
   * Calendar days between the due date and settlement for settled installments (negative means
   * paid early, 0 means paid on the due date), or the days overdue so far for unsettled
   * past-due installments (keeps growing until settled). Null when not applicable
   * (upcoming, fully waived, or settled without payment evidence).
   */
  daysLate: number | null;
}>;

function calendarDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysBetween(fromDay: number, toDay: number) {
  return Math.round((toDay - fromDay) / 86_400_000);
}

/**
 * Due-date vs paid-date comparison for one installment: when it was last paid, how many days
 * late that was (or how many days overdue it still is), and the derived timing label. Kept
 * alongside the timing classification so the schedule's "Paid on"/"Days late" columns and the
 * timing chip can never disagree with each other.
 */
export function installmentDueVsPaid(
  installment: InstallmentAmounts & Readonly<{ dueOn: Date }>,
  payments: readonly InstallmentPaymentEvidence[],
  asOfDate: Date,
): InstallmentDueVsPaid {
  const amountRequired = installmentDueMinor(installment) - installmentWaivedMinor(installment);
  if (amountRequired <= 0n) return { timing: "WAIVED", paidOn: null, daysLate: null };

  const evidence = payments.filter((payment) => payment.amountMinor > 0n);
  const amountPaid = installmentPaidMinor(installment);
  const dueDay = calendarDay(installment.dueOn);

  if (amountPaid >= amountRequired) {
    // Settled without any installment payment evidence: the gap was closed by charge payments
    // or waivers recorded outside repayment allocations, so no paid date exists to compare.
    if (evidence.length === 0) return { timing: "TIMING_UNAVAILABLE", paidOn: null, daysLate: null };
    // The remaining evidence may still sum below the required amount (charge payments and
    // waivers covered the gap). The latest repayment remains the best settlement evidence, so
    // classify by it rather than degrading to "timing unavailable".
    const paidOn = evidence.reduce((latest, payment) => (payment.businessDate > latest ? payment.businessDate : latest), evidence[0].businessDate);
    const daysLate = daysBetween(dueDay, calendarDay(paidOn));
    const timing = daysLate < 0 ? "PAID_EARLY" : daysLate === 0 ? "PAID_ON_TIME" : "PAID_LATE";
    return { timing, paidOn, daysLate };
  }

  const paidOn = evidence.length === 0
    ? null
    : evidence.reduce((latest, payment) => (payment.businessDate > latest ? payment.businessDate : latest), evidence[0].businessDate);
  const isPastDue = dueDay < calendarDay(asOfDate);
  if (amountPaid > 0n) {
    return isPastDue
      ? { timing: "PART_PAID_LATE", paidOn, daysLate: daysBetween(dueDay, calendarDay(asOfDate)) }
      : { timing: "PART_PAID", paidOn, daysLate: null };
  }
  return isPastDue
    ? { timing: "OVERDUE", paidOn: null, daysLate: daysBetween(dueDay, calendarDay(asOfDate)) }
    : { timing: "UPCOMING", paidOn: null, daysLate: null };
}

export function installmentPaymentTiming(
  installment: InstallmentAmounts & Readonly<{ dueOn: Date }>,
  payments: readonly InstallmentPaymentEvidence[],
  asOfDate: Date,
): InstallmentPaymentTiming {
  return installmentDueVsPaid(installment, payments, asOfDate).timing;
}

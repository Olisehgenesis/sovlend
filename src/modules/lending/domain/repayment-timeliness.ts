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

function calendarDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function installmentPaymentTiming(
  installment: InstallmentAmounts & Readonly<{ dueOn: Date }>,
  payments: readonly InstallmentPaymentEvidence[],
  asOfDate: Date,
): InstallmentPaymentTiming {
  const amountRequired = installmentDueMinor(installment) - installmentWaivedMinor(installment);
  if (amountRequired <= 0n) return "WAIVED";

  const amountPaid = installmentPaidMinor(installment);
  const collectedAmount = payments.reduce((sum, payment) => sum + payment.amountMinor, 0n);
  if (amountPaid >= amountRequired) {
    if (collectedAmount < amountRequired || payments.length === 0) return "TIMING_UNAVAILABLE";
    const completedOn = payments.reduce(
      (latest, payment) => (payment.businessDate > latest ? payment.businessDate : latest),
      payments[0].businessDate,
    );
    const completedDay = calendarDay(completedOn);
    const dueDay = calendarDay(installment.dueOn);
    if (completedDay < dueDay) return "PAID_EARLY";
    if (completedDay === dueDay) return "PAID_ON_TIME";
    return "PAID_LATE";
  }

  const isPastDue = calendarDay(installment.dueOn) < calendarDay(asOfDate);
  if (amountPaid > 0n) return isPastDue ? "PART_PAID_LATE" : "PART_PAID";
  return isPastDue ? "OVERDUE" : "UPCOMING";
}

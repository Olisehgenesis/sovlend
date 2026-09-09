import { z } from "zod";

export const standingOrderSweepJobSchema = z.object({
  requestKey: z.string().min(1),
  loanId: z.string().uuid(),
  installmentId: z.string().uuid(),
  clientId: z.string().uuid(),
  savingsAccountId: z.string().uuid(),
  accountNumber: z.string().min(1),
  dueOn: z.iso.datetime(),
  outstandingMinor: z.string().regex(/^\d+$/),
  currencyCode: z.string().min(3).max(10),
  mobileNumber: z.string().nullable(),
});

export type StandingOrderSweepJob = z.infer<typeof standingOrderSweepJobSchema>;

/** One idempotent sweep attempt per loan+trigger. Daily scans key by scan date; deposit-triggered
 * sweeps key by the deposit transaction id, so retries of the same trigger stay safe while fresh
 * deposits or future daily scans can legitimately collect again. */
export function standingOrderSweepJobId(job: Pick<StandingOrderSweepJob, "requestKey">): string {
  return job.requestKey;
}

export function buildStandingOrderDailyRequestKey(loanId: string, day: Date): string {
  return `standing-order-sweep:${loanId}:daily:${day.toISOString().slice(0, 10)}`;
}

export function buildStandingOrderDepositRequestKey(
  loanId: string,
  savingsTransactionId: string,
): string {
  return `standing-order-sweep:${loanId}:deposit:${savingsTransactionId}`;
}

/** Pure so it's trivially unit-testable: the sweep never pulls more than either the client's
 * available savings balance or the currently due/overdue loan amount, whichever is smaller, and
 * never a negative/zero amount. */
export function computeSweepAmountMinor(availableMinor: bigint, outstandingMinor: bigint): bigint {
  if (availableMinor <= 0n || outstandingMinor <= 0n) return 0n;
  return availableMinor < outstandingMinor ? availableMinor : outstandingMinor;
}

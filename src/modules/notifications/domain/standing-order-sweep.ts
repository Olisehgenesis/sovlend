import { z } from "zod";

export const standingOrderSweepJobSchema = z.object({
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

/** One job per loan per installment due-date, so re-running the daily scan never double-queues. */
export function standingOrderSweepJobId(job: Pick<StandingOrderSweepJob, "loanId" | "dueOn">): string {
  return `standing-order-sweep:${job.loanId}:${job.dueOn.slice(0, 10)}`;
}

/** Pure so it's trivially unit-testable: the sweep never pulls more than either the client's
 * available savings balance or the installment's outstanding amount, whichever is smaller, and
 * never a negative/zero amount. */
export function computeSweepAmountMinor(availableMinor: bigint, outstandingMinor: bigint): bigint {
  if (availableMinor <= 0n || outstandingMinor <= 0n) return 0n;
  return availableMinor < outstandingMinor ? availableMinor : outstandingMinor;
}

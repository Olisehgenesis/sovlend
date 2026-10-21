import { z } from "zod";

export const reminderJobSchema = z.object({
  loanId: z.string().uuid(),
  installmentId: z.string().uuid(),
  clientId: z.string().uuid(),
  accountNumber: z.string().min(1),
  type: z.enum(["REPAYMENT_DUE_SOON", "REPAYMENT_DUE_TODAY", "REPAYMENT_OVERDUE"]),
  dueOn: z.iso.datetime(),
  amountDueMinor: z.string().regex(/^\d+$/),
  feesDueMinor: z.string().regex(/^\d+$/),
  currencyCode: z.string().min(3).max(10),
  mobileNumber: z.string().nullable(),
});

export type ReminderJob = z.infer<typeof reminderJobSchema>;

export function reminderJobId(job: ReminderJob): string {
  return `repayment:${job.installmentId}:${job.type}`;
}

/** A queued reminder is stale once the installment due date, balance, or loan status has moved. */
export function reminderStillApplies(input: {
  jobDueOn: string;
  dueOn: Date;
  loanStatus: string;
  outstandingMinor: bigint;
}): boolean {
  if (input.loanStatus !== "ACTIVE" && input.loanStatus !== "IN_ARREARS") return false;
  if (input.outstandingMinor <= 0n) return false;
  return input.jobDueOn.slice(0, 10) === input.dueOn.toISOString().slice(0, 10);
}

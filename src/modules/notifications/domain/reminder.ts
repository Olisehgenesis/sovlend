import { z } from "zod";

export const reminderJobSchema = z.object({
  loanId: z.string().uuid(),
  installmentId: z.string().uuid(),
  clientId: z.string().uuid(),
  accountNumber: z.string().min(1),
  type: z.enum(["REPAYMENT_DUE_SOON", "REPAYMENT_DUE_TODAY", "REPAYMENT_OVERDUE"]),
  dueOn: z.iso.datetime(),
  amountDueMinor: z.string().regex(/^\d+$/),
  currencyCode: z.string().min(3).max(10),
});

export type ReminderJob = z.infer<typeof reminderJobSchema>;

export function reminderJobId(job: ReminderJob): string {
  return `repayment:${job.installmentId}:${job.type}`;
}
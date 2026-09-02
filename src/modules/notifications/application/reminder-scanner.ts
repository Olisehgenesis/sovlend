import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";

import { reminderJobId, type ReminderJob } from "../domain/reminder";

export async function enqueueRepaymentReminders(
  prisma: PrismaClient,
  queue: Queue,
  now = new Date(),
): Promise<number> {
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + 3);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 30);

  const installments = await prisma.loanInstallment.findMany({
    where: {
      dueOn: { gte: start, lte: horizon },
      loan: { status: { in: ["ACTIVE", "IN_ARREARS"] } },
    },
    include: { loan: { select: { id: true, clientId: true, accountNumber: true, denominationCurrency: true, client: { select: { mobileNumber: true } } } } },
  });

  let queued = 0;
  for (const installment of installments) {
    // Group-owned loans have no single client to notify by SMS; skip until group-level reminders are supported.
    if (!installment.loan.clientId) continue;

    const outstanding =
      installment.principalDueMinor + installment.interestDueMinor + installment.feesDueMinor + installment.penaltiesDueMinor -
      installment.principalPaidMinor - installment.interestPaidMinor - installment.feesPaidMinor - installment.penaltiesPaidMinor;

    if (outstanding <= 0n) continue;

    const feesOutstanding = installment.feesDueMinor + installment.penaltiesDueMinor - installment.feesPaidMinor - installment.penaltiesPaidMinor;
    const days = Math.floor((installment.dueOn.getTime() - now.getTime()) / 86_400_000);
    const type = days < 0 ? "REPAYMENT_OVERDUE" : days === 0 ? "REPAYMENT_DUE_TODAY" : "REPAYMENT_DUE_SOON";
    const data: ReminderJob = {
      loanId: installment.loan.id,
      installmentId: installment.id,
      clientId: installment.loan.clientId,
      accountNumber: installment.loan.accountNumber,
      type,
      dueOn: installment.dueOn.toISOString(),
      amountDueMinor: outstanding.toString(),
      feesDueMinor: (feesOutstanding > 0n ? feesOutstanding : 0n).toString(),
      currencyCode: installment.loan.denominationCurrency,
      mobileNumber: installment.loan.client?.mobileNumber ?? null,
    };

    await queue.add("repayment-reminder", data, {
      jobId: reminderJobId(data),
      attempts: 6,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 5_000,
      removeOnFail: 10_000,
    });
    queued += 1;
  }

  return queued;
}
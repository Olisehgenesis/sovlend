import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";

import { installmentOutstandingMinor } from "@/modules/lending/domain/loan-outstanding";

import { reminderJobId, type ReminderJob } from "../domain/reminder";

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function calendarDaysUntilDue(dueOn: Date, now: Date) {
  return Math.round((startOfUtcDay(dueOn).getTime() - startOfUtcDay(now).getTime()) / 86_400_000);
}

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

    const outstanding = installmentOutstandingMinor(installment);

    if (outstanding <= 0n) continue;

    // Reminder copy uses the legacy feesDueMinor payload slot as a catch-all "extra charges due"
    // amount, so monitoring fee is intentionally folded into it alongside generic fees/penalties.
    const feesOutstanding =
      outstanding -
      positive(installment.principalDueMinor - installment.principalPaidMinor - (installment.principalWaivedMinor ?? 0n)) -
      positive(installment.interestDueMinor - installment.interestPaidMinor - (installment.interestWaivedMinor ?? 0n));
    const days = calendarDaysUntilDue(installment.dueOn, now);
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

function positive(value: bigint) {
  return value > 0n ? value : 0n;
}

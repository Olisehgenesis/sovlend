import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";

import { standingOrderSweepJobId, type StandingOrderSweepJob } from "../domain/standing-order-sweep";

/**
 * Scans for loan installments due "today" and enqueues one standing-order-sweep job per
 * candidate, mirroring enqueueRepaymentReminders. A candidate needs: an ACTIVE/IN_ARREARS loan
 * with a direct (non-group) client, a positive outstanding amount on today's installment, and an
 * ACTIVE savings account flagged as that client's default. Loans/clients without a default
 * savings account are silently skipped (nothing to sweep from) rather than treated as an error.
 */
export async function enqueueStandingOrderSweeps(
  prisma: PrismaClient,
  queue: Queue,
  now = new Date(),
): Promise<number> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const installments = await prisma.loanInstallment.findMany({
    where: {
      dueOn: { gte: dayStart, lt: dayEnd },
      loan: { status: { in: ["ACTIVE", "IN_ARREARS"] }, clientId: { not: null } },
    },
    include: {
      loan: {
        select: {
          id: true,
          clientId: true,
          accountNumber: true,
          denominationCurrency: true,
          client: { select: { mobileNumber: true, savingsAccounts: { where: { isDefault: true, status: "ACTIVE" }, select: { id: true }, take: 1 } } },
        },
      },
    },
  });

  let queued = 0;
  for (const installment of installments) {
    if (!installment.loan.clientId) continue;
    const savingsAccount = installment.loan.client?.savingsAccounts[0];
    if (!savingsAccount) continue;

    const outstanding =
      installment.principalDueMinor + installment.interestDueMinor + installment.feesDueMinor + installment.penaltiesDueMinor -
      installment.principalPaidMinor - installment.interestPaidMinor - installment.feesPaidMinor - installment.penaltiesPaidMinor;
    if (outstanding <= 0n) continue;

    const data: StandingOrderSweepJob = {
      loanId: installment.loan.id,
      installmentId: installment.id,
      clientId: installment.loan.clientId,
      savingsAccountId: savingsAccount.id,
      accountNumber: installment.loan.accountNumber,
      dueOn: installment.dueOn.toISOString(),
      outstandingMinor: outstanding.toString(),
      currencyCode: installment.loan.denominationCurrency,
      mobileNumber: installment.loan.client?.mobileNumber ?? null,
    };

    await queue.add("standing-order-sweep", data, {
      jobId: standingOrderSweepJobId(data),
      attempts: 6,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 5_000,
      removeOnFail: 10_000,
    });
    queued += 1;
  }

  return queued;
}

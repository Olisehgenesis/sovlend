import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";

import { listStandingOrderSweepJobs } from "@/modules/lending/application/execute-standing-order-sweep";
import { buildStandingOrderDailyRequestKey, standingOrderSweepJobId } from "../domain/standing-order-sweep";

/**
 * Scans every direct client loan with at least one installment already due as of today's UTC end,
 * then enqueues at most one sweep job per loan for today's scan. Each job carries the loan's
 * total still-outstanding due/overdue balance (so postRepayment()'s existing allocator can spread
 * one sweep across multiple oldest-first installments) plus the oldest unpaid installment for
 * reminder/audit linkage. Loans with no resolvable funding account are skipped silently.
 */
export async function enqueueStandingOrderSweeps(
  prisma: PrismaClient,
  queue: Queue,
  now = new Date(),
): Promise<number> {
  const jobs = await listStandingOrderSweepJobs(prisma, {
    now,
    buildRequestKey: (loanId) => buildStandingOrderDailyRequestKey(loanId, now),
  });

  let queued = 0;
  for (const data of jobs) {
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

import { PrismaClient } from "@prisma/client";
import { Worker } from "bullmq";

import { enqueueRepaymentReminders } from "@/modules/notifications/application/reminder-scanner";
import { classifyLoanArrears } from "@/modules/lending/application/classify-arrears";
import { processLoanExportJob } from "@/modules/lending/application/export-loans";
import { reminderJobId, reminderJobSchema } from "@/modules/notifications/domain/reminder";
import { sendSms } from "@/modules/notifications/infrastructure/sms";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { CachedPriceService } from "@/modules/pricing/application/cached-price-service";
import { PriceAggregator } from "@/modules/pricing/application/price-aggregator";
import type { CurrencyPair } from "@/modules/pricing/domain/types";
import { createFiatProviders } from "@/modules/pricing/infrastructure/additional-providers";
import { BullMqPriceRefreshQueue, PrismaPriceSnapshotStore, RedisPriceCache } from "@/modules/pricing/infrastructure/price-cache-adapters";
import { createCryptoProviders } from "@/modules/pricing/infrastructure/providers";
import {
  domainEventQueue,
  loanExportQueue,
  maintenanceQueue,
  priceRefreshQueue,
  redisConnection,
  registerSchedules,
  reminderQueue,
} from "@/modules/notifications/infrastructure/queues";

const prisma = new PrismaClient();
let stopping = false;

const maintenanceWorker = new Worker(
  "maintenance",
  async (job) => {
    if (job.name === "scan-repayment-reminders") {
      return { queued: await enqueueRepaymentReminders(prisma, reminderQueue) };
    }
    if (job.name === "classify-loan-arrears") {
      return { changed: await classifyLoanArrears(prisma) };
    }
    throw new Error(`Unknown maintenance job: ${job.name}`);
  },
  { connection: redisConnection },
);

const reminderWorker = new Worker(
  "repayment-reminders",
  async (job) => {
    const data = reminderJobSchema.parse(job.data);
    const deduplicationKey = reminderJobId(data);
    const title = data.type === "REPAYMENT_OVERDUE" ? "Loan repayment overdue" : "Loan repayment reminder";
    const amount = formatMinor(BigInt(data.amountDueMinor), data.currencyCode);
    const dueDate = data.dueOn.slice(0, 10);
    const body = `${amount} is due for loan ${data.accountNumber} on ${dueDate}.`;

    const smsMessage =
      data.type === "REPAYMENT_DUE_SOON"
        ? `Reminder: your loan ${data.accountNumber} payment of ${amount} is due on ${dueDate}. Pay on time to avoid penalties.`
        : data.type === "REPAYMENT_DUE_TODAY"
          ? `Your loan ${data.accountNumber} payment of ${amount} is due TODAY (${dueDate}). Please pay to avoid penalties.`
          : `Your loan ${data.accountNumber} payment of ${amount} is OVERDUE (was due ${dueDate})${BigInt(data.feesDueMinor) > 0n ? `, including ${formatMinor(BigInt(data.feesDueMinor), data.currencyCode)} in fees/penalties` : ""}. Please pay immediately.`;

    const smsResult = data.mobileNumber ? await sendSms(data.mobileNumber, smsMessage) : { ok: false, error: "Client has no mobile number on file" };
    const channels = smsResult.ok ? ["IN_APP", "SMS"] : ["IN_APP"];

    return prisma.$transaction(async (transaction) => {
      const notification = await transaction.notification.upsert({
        where: { deduplicationKey },
        create: {
          audienceType: "CLIENT",
          audienceId: data.clientId,
          title,
          body,
          channels,
          deduplicationKey,
        },
        update: { channels },
      });

      return transaction.reminder.upsert({
        where: { deduplicationKey },
        create: {
          loanId: data.loanId,
          installmentId: data.installmentId,
          notificationId: notification.id,
          type: data.type,
          status: "SENT",
          scheduledFor: new Date(),
          deduplicationKey,
          attempts: job.attemptsMade + 1,
          sentAt: new Date(),
          lastError: smsResult.ok ? null : smsResult.error,
        },
        update: {
          notificationId: notification.id,
          status: "SENT",
          attempts: job.attemptsMade + 1,
          sentAt: new Date(),
          lastError: smsResult.ok ? null : smsResult.error,
        },
      });
    });
  },
  { connection: redisConnection, concurrency: 10 },
);

const priceWorker = new Worker(
  "price-refresh",
  async (job) => {
    const pair = job.data as CurrencyPair;
    const crypto = pair.base === "BTC" || pair.base === "USDC";
    const providers = crypto ? createCryptoProviders(process.env) : createFiatProviders(process.env);
    const aggregator = new PriceAggregator(providers, {
      minimumSources: crypto ? 3 : 1,
      timeoutMs: 4_000,
      maximumAgeMs: crypto ? 2 * 60_000 : 36 * 60 * 60_000,
      expiresAfterMs: crypto ? 2 * 60_000 : 60 * 60_000,
      maximumDeviationBps: crypto ? 150 : 300,
    });
    const service = new CachedPriceService(
      aggregator,
      new RedisPriceCache(redisConnection),
      new PrismaPriceSnapshotStore(prisma),
      new BullMqPriceRefreshQueue(priceRefreshQueue),
    );
    return service.refresh(pair);
  },
  { connection: redisConnection, concurrency: 2 },
);

const loanExportWorker = new Worker(
  "loan-export",
  async (job) => {
    const { jobId } = job.data as { jobId: string };
    return processLoanExportJob(prisma, jobId);
  },
  { connection: redisConnection, concurrency: 2 },
);

async function publishOutboxBatch(): Promise<void> {
  const events = await prisma.outboxEvent.findMany({
    where: { publishedAt: null },
    orderBy: { occurredAt: "asc" },
    take: 100,
  });

  for (const event of events) {
    await domainEventQueue.add(event.eventType, event.payload, {
      jobId: event.id,
      attempts: 8,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });

    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { publishedAt: new Date(), attempts: { increment: 1 } },
    });
  }
}

async function run(): Promise<void> {
  await registerSchedules();

  while (!stopping) {
    try {
      await publishOutboxBatch();
    } catch (error) {
      console.error("Outbox publication failed", error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function shutdown(): Promise<void> {
  stopping = true;
  await Promise.all([maintenanceWorker.close(), reminderWorker.close(), priceWorker.close(), loanExportWorker.close()]);
  await Promise.all([domainEventQueue.close(), maintenanceQueue.close(), reminderQueue.close(), priceRefreshQueue.close(), loanExportQueue.close()]);
  await redisConnection.quit();
  await prisma.$disconnect();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

void run();
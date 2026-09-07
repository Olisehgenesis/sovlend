import { Queue } from "bullmq";
import Redis from "ioredis";

export const redisConnection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const domainEventQueue = new Queue("domain-events", { connection: redisConnection });
export const reminderQueue = new Queue("repayment-reminders", { connection: redisConnection });
export const maintenanceQueue = new Queue("maintenance", { connection: redisConnection });
export const priceRefreshQueue = new Queue("price-refresh", { connection: redisConnection });
export const loanExportQueue = new Queue("loan-export", { connection: redisConnection });

export async function registerSchedules(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler(
    "repayment-reminder-scan",
    { pattern: "0 5 * * *" },
    { name: "scan-repayment-reminders", data: {} },
  );
  await maintenanceQueue.upsertJobScheduler(
    "daily-loan-arrears",
    { pattern: "15 0 * * *" },
    { name: "classify-loan-arrears", data: {} },
  );
  await priceRefreshQueue.upsertJobScheduler(
    "btc-usd-refresh",
    { every: 5 * 60 * 1_000 },
    { name: "refresh-price", data: { base: "BTC", quote: "USD" } },
  );
  await priceRefreshQueue.upsertJobScheduler(
    "usd-ugx-refresh",
    { every: 15 * 60 * 1_000 },
    { name: "refresh-price", data: { base: "USD", quote: "UGX" } },
  );
}
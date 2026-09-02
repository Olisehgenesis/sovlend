import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { sovlendRedis?: Redis };

export function getRedis() {
  if (!globalForRedis.sovlendRedis) {
    globalForRedis.sovlendRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return globalForRedis.sovlendRedis;
}
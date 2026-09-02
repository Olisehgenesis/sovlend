import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import type Redis from "ioredis";

import type { PriceCache, PriceRefreshQueue, PriceSnapshotStore } from "../application/cached-price-service";
import type { AggregatedPrice, CurrencyPair, ProviderQuote } from "../domain/types";

export class RedisPriceCache implements PriceCache {
  constructor(private readonly redis: Redis) {}

  async get(pair: CurrencyPair): Promise<AggregatedPrice | null> {
    const value = await this.redis.get(cacheKey(pair));
    if (!value) return null;
    const parsed = JSON.parse(value) as SerializedPrice;
    return {
      ...parsed,
      observedAt: new Date(parsed.observedAt),
      expiresAt: new Date(parsed.expiresAt),
      sources: parsed.sources.map((source) => ({ ...source, observedAt: new Date(source.observedAt), receivedAt: new Date(source.receivedAt) })),
    };
  }

  async set(price: AggregatedPrice, ttlSeconds: number) {
    await this.redis.set(cacheKey(price.pair), JSON.stringify(price), "EX", ttlSeconds);
  }
}

export class PrismaPriceSnapshotStore implements PriceSnapshotStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(price: AggregatedPrice) {
    await this.prisma.priceSnapshot.create({
      data: {
        baseCode: price.pair.base,
        quoteCode: price.pair.quote,
        price: price.price,
        status: price.status,
        observedAt: price.observedAt,
        expiresAt: price.expiresAt,
        sourceQuotes: price.sources.map((source) => ({ ...source, observedAt: source.observedAt.toISOString(), receivedAt: source.receivedAt.toISOString() })),
      },
    });
  }
}

export class BullMqPriceRefreshQueue implements PriceRefreshQueue {
  constructor(private readonly queue: Queue) {}

  async enqueue(pair: CurrencyPair) {
    const bucket = Math.floor(Date.now() / 300_000);
    await this.queue.add("refresh-price", pair, {
      jobId: `price:${pair.base}:${pair.quote}:${bucket}`,
      attempts: 6,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }
}

function cacheKey(pair: CurrencyPair) {
  return `price:v1:${pair.base}:${pair.quote}`;
}

type SerializedQuote = Omit<ProviderQuote, "observedAt" | "receivedAt"> & { observedAt: string; receivedAt: string };
type SerializedPrice = Omit<AggregatedPrice, "observedAt" | "expiresAt" | "sources"> & {
  observedAt: string;
  expiresAt: string;
  sources: SerializedQuote[];
};
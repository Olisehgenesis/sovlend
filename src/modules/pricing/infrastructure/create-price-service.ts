import { Queue } from "bullmq";

import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { CachedPriceService } from "../application/cached-price-service";
import { PriceAggregator } from "../application/price-aggregator";
import type { CurrencyPair } from "../domain/types";
import { createFiatProviders } from "./additional-providers";
import { BullMqPriceRefreshQueue, PrismaPriceSnapshotStore, RedisPriceCache } from "./price-cache-adapters";
import { createCryptoProviders } from "./providers";

export function createPriceService(pair: CurrencyPair) {
  const crypto = pair.base === "BTC" || pair.base === "USDC";
  const aggregator = new PriceAggregator(
    crypto ? createCryptoProviders(process.env) : createFiatProviders(process.env),
    {
      minimumSources: crypto ? 3 : 2,
      timeoutMs: 4_000,
      maximumAgeMs: crypto ? 2 * 60_000 : 36 * 60 * 60_000,
      expiresAfterMs: crypto ? 2 * 60_000 : 60 * 60_000,
      maximumDeviationBps: crypto ? 150 : 300,
    },
  );
  const redis = getRedis();
  const queue = new Queue("price-refresh", { connection: redis });
  return new CachedPriceService(
    aggregator,
    new RedisPriceCache(redis),
    new PrismaPriceSnapshotStore(prisma),
    new BullMqPriceRefreshQueue(queue),
  );
}
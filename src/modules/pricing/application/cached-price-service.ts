import type { AggregatedPrice, CurrencyPair } from "../domain/types";
import type { PriceAggregator } from "./price-aggregator";
import { PriceUnavailableError } from "./price-aggregator";

export type PricePurpose = "DISPLAY" | "TRANSACTION";

export interface PriceCache {
  get(pair: CurrencyPair): Promise<AggregatedPrice | null>;
  set(price: AggregatedPrice, ttlSeconds: number): Promise<void>;
}

export interface PriceSnapshotStore {
  save(price: AggregatedPrice): Promise<void>;
}

export interface PriceRefreshQueue {
  enqueue(pair: CurrencyPair): Promise<void>;
}

export class CachedPriceService {
  private static readonly displayMaxAgeMs = 60 * 60 * 1_000;
  private static readonly transactionMaxAgeMs = 2 * 60 * 1_000;
  private static readonly refreshAfterMs = 5 * 60 * 1_000;

  constructor(
    private readonly aggregator: PriceAggregator,
    private readonly cache: PriceCache,
    private readonly snapshots: PriceSnapshotStore,
    private readonly refreshQueue: PriceRefreshQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPrice(pair: CurrencyPair, purpose: PricePurpose): Promise<AggregatedPrice> {
    const cached = await this.cache.get(pair);
    if (cached) {
      const age = this.now().getTime() - cached.observedAt.getTime();
      if (purpose === "DISPLAY" && age <= CachedPriceService.displayMaxAgeMs) {
        if (age >= CachedPriceService.refreshAfterMs) void this.refreshQueue.enqueue(pair);
        return cached;
      }
      if (purpose === "TRANSACTION" && age <= CachedPriceService.transactionMaxAgeMs && cached.sources.length >= 2) {
        return cached;
      }
    }

    const fresh = await this.refresh(pair);
    if (purpose === "TRANSACTION" && fresh.sources.length < 2) {
      throw new PriceUnavailableError(`Transaction price quorum unavailable for ${pair.base}/${pair.quote}`);
    }
    return fresh;
  }

  async refresh(pair: CurrencyPair): Promise<AggregatedPrice> {
    const price = await this.aggregator.getPrice(pair);
    await this.snapshots.save(price);
    await this.cache.set(price, CachedPriceService.displayMaxAgeMs / 1_000);
    return price;
  }
}
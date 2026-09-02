import { describe, expect, it, vi } from "vitest";

import type { AggregatedPrice } from "../domain/types";
import { CachedPriceService } from "./cached-price-service";

const now = new Date("2026-09-01T12:00:00Z");
const pair = { base: "BTC", quote: "USD" };

function price(ageMs: number): AggregatedPrice {
  return {
    pair,
    price: "62510",
    status: "QUORUM",
    observedAt: new Date(now.getTime() - ageMs),
    expiresAt: new Date(now.getTime() + 120_000),
    sources: ["a", "b", "c"].map((provider) => ({ provider, pair, price: "62510", observedAt: now, receivedAt: now })),
  };
}

describe("CachedPriceService", () => {
  it("serves an hour-old display cache without blocking on providers", async () => {
    const aggregator = { getPrice: vi.fn() };
    const refreshQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const service = new CachedPriceService(
      aggregator as never,
      { get: vi.fn().mockResolvedValue(price(30 * 60_000)), set: vi.fn() },
      { save: vi.fn() },
      refreshQueue,
      () => now,
    );

    expect((await service.getPrice(pair, "DISPLAY")).price).toBe("62510");
    expect(aggregator.getPrice).not.toHaveBeenCalled();
    expect(refreshQueue.enqueue).toHaveBeenCalledWith(pair);
  });

  it("refreshes a quote that is too old for a transaction", async () => {
    const fresh = price(0);
    const aggregator = { getPrice: vi.fn().mockResolvedValue(fresh) };
    const snapshots = { save: vi.fn().mockResolvedValue(undefined) };
    const cache = { get: vi.fn().mockResolvedValue(price(3 * 60_000)), set: vi.fn().mockResolvedValue(undefined) };
    const service = new CachedPriceService(aggregator as never, cache, snapshots, { enqueue: vi.fn() }, () => now);

    await service.getPrice(pair, "TRANSACTION");
    expect(aggregator.getPrice).toHaveBeenCalledWith(pair);
    expect(snapshots.save).toHaveBeenCalledWith(fresh);
  });
});
import { describe, expect, it } from "vitest";

import type { PriceProvider } from "../domain/types";
import { PriceAggregator, PriceUnavailableError } from "./price-aggregator";

const NOW = new Date("2026-09-01T12:00:00Z");
const pair = { base: "BTC", quote: "USD" };
const policy = {
  minimumSources: 2,
  timeoutMs: 100,
  maximumAgeMs: 60_000,
  expiresAfterMs: 30_000,
  maximumDeviationBps: 200,
};

function provider(name: string, price: string, observedAt = NOW): PriceProvider {
  return {
    name,
    async getQuote(requestedPair) {
      return { provider: name, pair: requestedPair, price, observedAt, receivedAt: NOW };
    },
  };
}

describe("PriceAggregator", () => {
  it("uses the median and excludes outliers", async () => {
    const service = new PriceAggregator(
      [provider("a", "62500"), provider("b", "62520"), provider("outlier", "80000")],
      policy,
      () => NOW,
    );

    const result = await service.getPrice(pair);

    expect(result.price).toBe("62510");
    expect(result.sources.map((source) => source.provider)).toEqual(["a", "b"]);
  });

  it("fails closed without enough fresh sources", async () => {
    const stale = new Date(NOW.getTime() - 120_000);
    const service = new PriceAggregator(
      [provider("fresh", "62500"), provider("stale", "62510", stale)],
      policy,
      () => NOW,
    );

    await expect(service.getPrice(pair)).rejects.toBeInstanceOf(PriceUnavailableError);
  });
});
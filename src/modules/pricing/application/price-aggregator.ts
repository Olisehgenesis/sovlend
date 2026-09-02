import Decimal from "decimal.js";

import type {
  AggregatedPrice,
  CurrencyPair,
  PriceProvider,
  ProviderQuote,
} from "../domain/types";

export type PricePolicy = Readonly<{
  minimumSources: number;
  timeoutMs: number;
  maximumAgeMs: number;
  expiresAfterMs: number;
  maximumDeviationBps: number;
}>;

export class PriceUnavailableError extends Error {}

export class PriceAggregator {
  constructor(
    private readonly providers: readonly PriceProvider[],
    private readonly policy: PricePolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPrice(pair: CurrencyPair): Promise<AggregatedPrice> {
    const quotes = await Promise.allSettled(
      this.providers.map((provider) => this.fetchWithRetry(provider, pair)),
    );

    const freshQuotes = quotes
      .filter((result): result is PromiseFulfilledResult<ProviderQuote> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((quote) => this.now().getTime() - quote.observedAt.getTime() <= this.policy.maximumAgeMs);

    if (freshQuotes.length < this.policy.minimumSources) {
      throw new PriceUnavailableError(
        `Price quorum unavailable for ${pair.base}/${pair.quote}: ${freshQuotes.length}/${this.policy.minimumSources}`,
      );
    }

    const median = calculateMedian(freshQuotes.map((quote) => new Decimal(quote.price)));
    const accepted = freshQuotes.filter((quote) => {
      const deviation = new Decimal(quote.price).sub(median).abs().div(median).mul(10_000);
      return deviation.lte(this.policy.maximumDeviationBps);
    });

    if (accepted.length < this.policy.minimumSources) {
      throw new PriceUnavailableError(`Price sources disagree for ${pair.base}/${pair.quote}`);
    }

    const finalMedian = calculateMedian(accepted.map((quote) => new Decimal(quote.price)));
    const observedAt = new Date(Math.max(...accepted.map((quote) => quote.observedAt.getTime())));

    return {
      pair,
      price: finalMedian.toFixed(),
      status: accepted.length >= 3 ? "QUORUM" : "DEGRADED",
      observedAt,
      expiresAt: new Date(this.now().getTime() + this.policy.expiresAfterMs),
      sources: accepted,
    };
  }

  private async fetchWithRetry(provider: PriceProvider, pair: CurrencyPair): Promise<ProviderQuote> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.policy.timeoutMs);

      try {
        return await provider.getQuote(pair, controller.signal);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt + Math.random() * 50));
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`${provider.name} failed`);
  }
}

function calculateMedian(values: Decimal[]): Decimal {
  const sorted = [...values].sort((left, right) => left.comparedTo(right));
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return sorted[middle - 1].add(sorted[middle]).div(2);
}
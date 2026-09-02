import type { CurrencyPair, PriceProvider, ProviderQuote } from "../domain/types";

type QuoteParser = (payload: unknown, pair: CurrencyPair) => string;

export class HttpJsonPriceProvider implements PriceProvider {
  constructor(
    readonly name: string,
    private readonly buildUrl: (pair: CurrencyPair) => string,
    private readonly parse: QuoteParser,
    private readonly headers: HeadersInit = {},
  ) {}

  async getQuote(pair: CurrencyPair, signal: AbortSignal): Promise<ProviderQuote> {
    const response = await fetch(this.buildUrl(pair), {
      headers: this.headers,
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`${this.name} returned HTTP ${response.status}`);
    }

    return {
      provider: this.name,
      pair,
      price: this.parse(await response.json(), pair),
      observedAt: new Date(),
      receivedAt: new Date(),
    };
  }
}
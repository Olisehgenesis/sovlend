export type CurrencyPair = Readonly<{
  base: string;
  quote: string;
}>;

export type ProviderQuote = Readonly<{
  provider: string;
  pair: CurrencyPair;
  price: string;
  observedAt: Date;
  receivedAt: Date;
}>;

export interface PriceProvider {
  readonly name: string;
  getQuote(pair: CurrencyPair, signal: AbortSignal): Promise<ProviderQuote>;
}

export type AggregatedPrice = Readonly<{
  pair: CurrencyPair;
  price: string;
  status: "QUORUM" | "DEGRADED";
  observedAt: Date;
  expiresAt: Date;
  sources: readonly ProviderQuote[];
}>;
import Decimal from "decimal.js";
import { z } from "zod";

import type { CurrencyPair, PriceProvider, ProviderQuote } from "../domain/types";

const unknownRecord = z.record(z.string(), z.unknown());

abstract class JsonProvider implements PriceProvider {
  abstract readonly name: string;
  abstract getUrl(pair: CurrencyPair): string;
  abstract parse(payload: unknown, pair: CurrencyPair): { price: string; observedAt?: Date };

  protected getHeaders(): HeadersInit {
    return {};
  }

  async getQuote(pair: CurrencyPair, signal: AbortSignal): Promise<ProviderQuote> {
    const response = await fetch(this.getUrl(pair), {
      signal,
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${this.name} returned HTTP ${response.status}`);
    const parsed = this.parse(await response.json(), pair);
    const receivedAt = new Date();
    return { provider: this.name, pair, price: parsed.price, observedAt: parsed.observedAt ?? receivedAt, receivedAt };
  }
}

export class CurrencyFreaksProvider extends JsonProvider {
  readonly name = "currencyfreaks";

  constructor(private readonly apiKey: string) {
    super();
  }

  getUrl(pair: CurrencyPair) {
    const symbols = encodeURIComponent(`${pair.base},${pair.quote}`);
    return `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${encodeURIComponent(this.apiKey)}&symbols=${symbols}`;
  }

  parse(payload: unknown, pair: CurrencyPair) {
    const root = unknownRecord.parse(payload);
    const rates = z.record(z.string(), z.coerce.string()).parse(root.rates);
    const baseRate = pair.base === "USD" ? new Decimal(1) : new Decimal(rates[pair.base]);
    const quoteRate = pair.quote === "USD" ? new Decimal(1) : new Decimal(rates[pair.quote]);
    return { price: quoteRate.div(baseRate).toFixed(), observedAt: new Date(z.string().parse(root.date)) };
  }
}

export class ExchangeRateApiProvider extends JsonProvider {
  readonly name = "exchangerate-api";

  constructor(private readonly apiKey: string) {
    super();
  }

  getUrl(pair: CurrencyPair) {
    return `https://v6.exchangerate-api.com/v6/${encodeURIComponent(this.apiKey)}/latest/${encodeURIComponent(pair.base)}`;
  }

  parse(payload: unknown, pair: CurrencyPair) {
    const root = unknownRecord.parse(payload);
    if (root.result !== "success") throw new Error(`ExchangeRate-API error: ${String(root["error-type"] ?? "unknown")}`);
    const rates = z.record(z.string(), z.coerce.string()).parse(root.conversion_rates);
    return {
      price: new Decimal(rates[pair.quote]).toFixed(),
      observedAt: new Date(z.number().parse(root.time_last_update_unix) * 1_000),
    };
  }
}

export class FawazExchangeProvider extends JsonProvider {
  readonly name = "fawaz-exchange";
  private host = "jsdelivr";

  getUrl(pair: CurrencyPair) {
    const base = pair.base.toLowerCase();
    if (this.host === "cloudflare") return `https://latest.currency-api.pages.dev/v1/currencies/${base}.min.json`;
    return `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base}.min.json`;
  }

  override async getQuote(pair: CurrencyPair, signal: AbortSignal) {
    try {
      return await super.getQuote(pair, signal);
    } catch {
      this.host = "cloudflare";
      try {
        return await super.getQuote(pair, signal);
      } finally {
        this.host = "jsdelivr";
      }
    }
  }

  parse(payload: unknown, pair: CurrencyPair) {
    const root = unknownRecord.parse(payload);
    const rates = z.record(z.string(), z.coerce.string()).parse(root[pair.base.toLowerCase()]);
    return { price: new Decimal(rates[pair.quote.toLowerCase()]).toFixed(), observedAt: new Date(z.string().parse(root.date)) };
  }
}

export class FreeCryptoApiProvider extends JsonProvider {
  readonly name = "freecryptoapi";

  constructor(private readonly apiKey: string, private readonly baseUrl: string) {
    super();
  }

  protected getHeaders(): HeadersInit {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  getUrl(pair: CurrencyPair) {
    const url = new URL("getDataCurrency", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    url.searchParams.set("symbol", pair.base);
    url.searchParams.set("currency", pair.quote);
    return url.toString();
  }

  parse(payload: unknown, pair: CurrencyPair) {
    const root = unknownRecord.parse(payload);
    const rawData = root.data ?? root;
    const item = Array.isArray(rawData)
      ? unknownRecord.parse(rawData.find((entry) => unknownRecord.safeParse(entry).success && unknownRecord.parse(entry).symbol === pair.base))
      : unknownRecord.parse(rawData);
    const value = item.price ?? item.current_price ?? item.rate;
    return { price: new Decimal(z.union([z.string(), z.number()]).parse(value)).toFixed() };
  }
}

export function createFiatProviders(environment: NodeJS.ProcessEnv): PriceProvider[] {
  const providers: PriceProvider[] = [new FawazExchangeProvider()];
  if (environment.CURRENCYFREAKS_API_KEY) providers.unshift(new CurrencyFreaksProvider(environment.CURRENCYFREAKS_API_KEY));
  if (environment.EXCHANGERATE_API_KEY) providers.unshift(new ExchangeRateApiProvider(environment.EXCHANGERATE_API_KEY));
  return providers;
}
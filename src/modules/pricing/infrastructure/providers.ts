import { z } from "zod";

import type { PriceProvider } from "../domain/types";
import { HttpJsonPriceProvider } from "./http-json-provider";
import { FawazExchangeProvider, FreeCryptoApiProvider } from "./additional-providers";

const recordSchema = z.record(z.string(), z.unknown());
const coinGeckoIds: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", USDC: "usd-coin" };

export function createCryptoProviders(environment: NodeJS.ProcessEnv): PriceProvider[] {
  const providers: PriceProvider[] = [
    new HttpJsonPriceProvider(
      "coingecko",
      ({ base, quote }) =>
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinGeckoIds[base] ?? base.toLowerCase()}&vs_currencies=${quote.toLowerCase()}`,
      (payload, pair) => String(recordSchema.parse(recordSchema.parse(payload)[coinGeckoIds[pair.base] ?? pair.base.toLowerCase()])[pair.quote.toLowerCase()]),
      environment.COINGECKO_API_KEY ? { "x-cg-pro-api-key": environment.COINGECKO_API_KEY } : {},
    ),
    new HttpJsonPriceProvider(
      "coinmarketcap",
      ({ base, quote }) =>
        `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${base}&convert=${quote}`,
      (payload, pair) => {
        const root = recordSchema.parse(payload);
        const data = recordSchema.parse(root.data);
        const asset = z.array(recordSchema).parse(data[pair.base])[0];
        const quote = recordSchema.parse(recordSchema.parse(asset.quote)[pair.quote]);
        return String(quote.price);
      },
      environment.COINMARKETCAP_API_KEY ? { "X-CMC_PRO_API_KEY": environment.COINMARKETCAP_API_KEY } : {},
    ),
    new HttpJsonPriceProvider(
      "kraken",
      ({ base, quote }) => `https://api.kraken.com/0/public/Ticker?pair=${base}${quote}`,
      (payload) => {
        const result = recordSchema.parse(recordSchema.parse(payload).result);
        const ticker = recordSchema.parse(Object.values(result)[0]);
        return z.array(z.string()).parse(ticker.c)[0];
      },
    ),
    new HttpJsonPriceProvider(
      "coinbase",
      ({ base, quote }) => `https://api.coinbase.com/v2/prices/${base}-${quote}/spot`,
      (payload) => String(recordSchema.parse(recordSchema.parse(payload).data).amount),
    ),
  ];

  providers.push(new FawazExchangeProvider());
  if (environment.FREECRYPTO_API_KEY && environment.FREECRYPTO_API_BASE_URL) {
    providers.push(new FreeCryptoApiProvider(environment.FREECRYPTO_API_KEY, environment.FREECRYPTO_API_BASE_URL));
  }

  return providers;
}
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { contributionToSats } from "@/modules/investments/domain/conversion";
import { PriceAggregator, PriceUnavailableError } from "@/modules/pricing/application/price-aggregator";
import type { AggregatedPrice, CurrencyPair } from "@/modules/pricing/domain/types";
import { createFiatProviders } from "@/modules/pricing/infrastructure/additional-providers";
import { createPriceService } from "@/modules/pricing/infrastructure/create-price-service";
import { createCryptoProviders } from "@/modules/pricing/infrastructure/providers";

const querySchema = z.object({
  currencyCode: z.enum(["UGX", "USD"]),
  amountMinor: z.string().regex(/^\d+$/),
});

/**
 * Read-only "how many sats is this?" preview for the investor invest form. Uses the DISPLAY
 * price purpose (see CachedPriceService) which is served from cache for up to an hour and only
 * refreshes in the background -- unlike the TRANSACTION purpose used at actual invoice creation,
 * this deliberately avoids hitting the upstream price providers on every keystroke/preview.
 *
 * If quorum can't be reached (e.g. a fiat provider key is missing/rate-limited), this falls back
 * to a single-source, non-cached estimate -- fine for a preview since "a fresh rate is locked
 * when the invoice is created" is already stated on the invest form. The real investment/invoice
 * creation path (create-investment.ts) is untouched and still requires full source quorum.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    currencyCode: url.searchParams.get("currencyCode"),
    amountMinor: url.searchParams.get("amountMinor"),
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid amount or currency" }, { status: 400 });
  const { currencyCode, amountMinor } = parsed.data;
  if (amountMinor === "0") return NextResponse.json({ error: "Enter a positive amount" }, { status: 400 });

  try {
    let approximate = false;
    const markApproximate = () => {
      approximate = true;
    };
    const [btcUsd, usdUgx] = await Promise.all([
      getPriceWithFallback({ base: "BTC", quote: "USD" }, markApproximate),
      currencyCode === "UGX" ? getPriceWithFallback({ base: "USD", quote: "UGX" }, markApproximate) : Promise.resolve(null),
    ]);

    const amountSats = contributionToSats({
      amountMinor: BigInt(amountMinor),
      currencyCode,
      btcUsd: btcUsd.price,
      usdUgx: usdUgx?.price,
    });
    return NextResponse.json({ amountSats: amountSats.toString(), observedAt: btcUsd.observedAt, approximate });
  } catch {
    return NextResponse.json({ error: "Price is temporarily unavailable" }, { status: 503 });
  }
}

async function getPriceWithFallback(pair: CurrencyPair, onFallback: () => void): Promise<AggregatedPrice> {
  try {
    return await createPriceService(pair).getPrice(pair, "DISPLAY");
  } catch (error) {
    if (!(error instanceof PriceUnavailableError)) throw error;
    onFallback();
    const crypto = pair.base === "BTC" || pair.base === "USDC";
    const lenient = new PriceAggregator(crypto ? createCryptoProviders(process.env) : createFiatProviders(process.env), {
      minimumSources: 1,
      timeoutMs: 4_000,
      maximumAgeMs: crypto ? 2 * 60_000 : 36 * 60 * 60_000,
      expiresAfterMs: crypto ? 2 * 60_000 : 60 * 60_000,
      maximumDeviationBps: crypto ? 150 : 300,
    });
    return lenient.getPrice(pair);
  }
}

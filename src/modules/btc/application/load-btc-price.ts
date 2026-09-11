import type { PrismaClient } from "@prisma/client";

// Matches the freshness windows already used in the main dashboard (see
// src/modules/reporting/application/dashboard.ts) so a BTC balance shown here and on the
// dashboard never disagree just because of different staleness thresholds.
const CRYPTO_FRESH_WINDOW_MS = 60 * 60 * 1_000;
const FIAT_FRESH_WINDOW_MS = 36 * 60 * 60 * 1_000;

export type BtcUgxPrice = { priceUgx: number; priceUsd: number; observedAt: Date } | null;

/** Combines the latest fresh BTC/USD and USD/UGX price snapshots into a single BTC/UGX rate,
 * for converting a sats balance into a local-currency equivalent (docs/btc-integration-plan.md
 * §3). Returns null rather than a stale/guessed rate when either leg's snapshot has expired. */
export async function loadBtcUgxPrice(prisma: Pick<PrismaClient, "priceSnapshot">): Promise<BtcUgxPrice> {
  const now = new Date();
  const [btcUsd, usdUgx] = await Promise.all([
    prisma.priceSnapshot.findFirst({
      where: { baseCode: "BTC", quoteCode: "USD", observedAt: { gt: new Date(now.getTime() - CRYPTO_FRESH_WINDOW_MS) } },
      orderBy: { observedAt: "desc" },
      select: { price: true, observedAt: true },
    }),
    prisma.priceSnapshot.findFirst({
      where: { baseCode: "USD", quoteCode: "UGX", observedAt: { gt: new Date(now.getTime() - FIAT_FRESH_WINDOW_MS) } },
      orderBy: { observedAt: "desc" },
      select: { price: true, observedAt: true },
    }),
  ]);
  if (!btcUsd || !usdUgx) return null;
  const priceUsd = Number(btcUsd.price);
  return {
    priceUsd,
    priceUgx: priceUsd * Number(usdUgx.price),
    observedAt: btcUsd.observedAt < usdUgx.observedAt ? btcUsd.observedAt : usdUgx.observedAt,
  };
}

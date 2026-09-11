import Decimal from "decimal.js";

export const SATS_PER_BTC = 100_000_000n;

export const BTC_ACCOUNT_SOURCES = ["MANUAL", "ON_CHAIN_ADDRESS"] as const;
export type BtcAccountSource = (typeof BTC_ACCOUNT_SOURCES)[number];

export const BTC_ACCOUNT_STATUSES = ["ACTIVE", "CLOSED"] as const;
export type BtcAccountStatus = (typeof BTC_ACCOUNT_STATUSES)[number];

/** A price snapshot pair as already produced by the dashboard/investments price-feed jobs
 * (BTC/USD and USD/UGX), reused here so a sats balance can be shown with its local-currency
 * equivalent -- see docs/btc-integration-plan.md §3. */
export type BtcPricePoint = { priceUgx: number; observedAt: Date } | null;

/** Converts a satoshi balance into UGX minor units (cents) using a BTC/UGX price already
 * combined from BTC/USD * USD/UGX (see loadBtcUgxPrice). Returns null when no fresh price is
 * available rather than showing a stale or fabricated conversion. */
export function satsToUgxMinor(sats: bigint, btcPriceUgx: number | null): bigint | null {
  if (btcPriceUgx === null) return null;
  const btc = new Decimal(sats.toString()).div(SATS_PER_BTC.toString());
  return BigInt(btc.mul(btcPriceUgx).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

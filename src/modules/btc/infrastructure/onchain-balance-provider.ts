/** Reads a public on-chain BTC address balance for Phase 1's read-only custody mode (see
 * docs/btc-integration-plan.md §7): SovLend never holds a key for these funds, it only displays
 * what is already publicly visible on the blockchain for an address a client has told staff
 * about. Uses mempool.space's public REST API, which requires no API key. Every call is
 * time-boxed and failure-tolerant -- a slow or unreachable explorer must never break the page
 * that shows it, only degrade that one account's balance to "unavailable". */

const EXPLORER_BASE_URL = process.env.BTC_EXPLORER_API_URL ?? "https://mempool.space/api";
const REQUEST_TIMEOUT_MS = 4_000;

type AddressStats = {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
};

export type OnChainBalanceResult = { balanceSats: bigint; fetchedAt: Date } | null;

export async function fetchOnChainBalanceSats(address: string): Promise<OnChainBalanceResult> {
  try {
    const response = await fetch(`${EXPLORER_BASE_URL}/address/${encodeURIComponent(address)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const stats = (await response.json()) as AddressStats;
    const confirmedSats = BigInt(stats.chain_stats.funded_txo_sum) - BigInt(stats.chain_stats.spent_txo_sum);
    const mempoolSats = BigInt(stats.mempool_stats.funded_txo_sum) - BigInt(stats.mempool_stats.spent_txo_sum);
    return { balanceSats: confirmedSats + mempoolSats, fetchedAt: new Date() };
  } catch {
    // Network error, timeout, or malformed response -- caller shows "balance unavailable"
    // rather than propagating and failing the whole page.
    return null;
  }
}

import { BlinkGateway } from "./blink-gateway";
import type { LightningGateway } from "../domain/lightning-gateway";

/** Reads Blink's server-side credentials from the environment and builds the gateway used by
 * both invoice creation (/api/investments) and the settlement webhook (/api/lightning/webhook),
 * so there is exactly one place that knows how those env vars map to a LightningGateway.
 * Returns null when unconfigured so callers can respond 503 instead of throwing. */
export function createLightningGateway(): LightningGateway | null {
  const apiKey = process.env.BLINK_API_KEY;
  const walletId = process.env.BLINK_WALLET_ID;
  if (!apiKey || !walletId) return null;
  return new BlinkGateway(apiKey, walletId, process.env.BLINK_API_URL || undefined);
}

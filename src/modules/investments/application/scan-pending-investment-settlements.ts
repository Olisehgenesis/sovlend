import type { PrismaClient } from "@prisma/client";

import type { LightningGateway } from "../domain/lightning-gateway";
import { settleLightningInvoice } from "./settle-lightning-invoice";

/**
 * Background safety net for the Blink webhook (see /api/lightning/webhook): periodically
 * re-polls every still-open Lightning invoice for a pending investment commitment, in case a
 * webhook delivery was dropped or delayed. Investors can also trigger this manually via the
 * "Check status"/"Check payment status" buttons (see /api/investments/[id]/check-status) --
 * this job exists so settlement is still caught even if nobody is looking at the page.
 * Reuses the same idempotent `settleLightningInvoice` guard, so this can never race/double-credit
 * against the webhook or a manual check.
 */
export async function scanPendingInvestmentSettlements(
  prisma: PrismaClient,
  gateway: LightningGateway,
): Promise<{ checked: number; settled: number }> {
  const pending = await prisma.investmentCommitment.findMany({
    where: { status: "AWAITING_PAYMENT", invoice: { status: "NEW" } },
    include: { invoice: true },
  });

  let settled = 0;
  for (const commitment of pending) {
    if (!commitment.invoice?.paymentHash) continue;
    const isSettled = await gateway.isSettled(commitment.invoice.paymentHash);
    if (isSettled && (await settleLightningInvoice(prisma, commitment.invoice, commitment.invoice.paymentHash))) settled += 1;
  }

  return { checked: pending.length, settled };
}

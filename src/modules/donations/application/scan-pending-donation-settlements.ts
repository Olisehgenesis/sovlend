import type { PrismaClient } from "@prisma/client";

import type { LightningGateway } from "@/modules/investments/domain/lightning-gateway";

import { settleDonationLightningInvoice } from "./settle-donation-lightning-invoice";

/** Same safety net as the investment scan: catch a paid donation invoice if the Blink webhook is late. */
export async function scanPendingDonationSettlements(
  prisma: PrismaClient,
  gateway: LightningGateway,
): Promise<{ checked: number; settled: number }> {
  const pending = await prisma.donationLightningInvoice.findMany({
    where: {
      status: "NEW",
      paymentHash: { not: null },
      expiresAt: { gt: new Date(Date.now() - 5 * 60_000) },
    },
  });

  let settled = 0;
  for (const invoice of pending) {
    if (!invoice.paymentHash) continue;
    const isSettled = await gateway.isSettled(invoice.paymentHash);
    if (isSettled && (await settleDonationLightningInvoice(prisma, invoice))) settled += 1;
  }

  return { checked: pending.length, settled };
}

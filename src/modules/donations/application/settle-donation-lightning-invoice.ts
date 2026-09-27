import type { PrismaClient } from "@prisma/client";

type SettleableDonationInvoice = {
  id: string;
  donationRequestId: string;
  amountSats: bigint;
  amountUsdMinor: bigint;
};

/**
 * Idempotently marks a donation Lightning invoice paid and the donation successful.
 * The status guard matches the investment settlement path, so a webhook and a status
 * poll can race without recording the gift twice.
 */
export async function settleDonationLightningInvoice(prisma: PrismaClient, invoice: SettleableDonationInvoice): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    const changed = await transaction.donationLightningInvoice.updateMany({
      where: { id: invoice.id, status: "NEW" },
      data: { status: "PAID", settledAt: new Date() },
    });
    if (changed.count !== 1) return false;
    await transaction.donationRequest.update({
      where: { id: invoice.donationRequestId },
      data: {
        status: "SUCCEEDED",
        succeededAt: new Date(),
        amountUsdMinor: invoice.amountUsdMinor,
        amountSats: invoice.amountSats,
      },
    });
    return true;
  });
}

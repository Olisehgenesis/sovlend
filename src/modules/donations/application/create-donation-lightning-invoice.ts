import type { PrismaClient } from "@prisma/client";

import type { CachedPriceService } from "@/modules/pricing/application/cached-price-service";
import { contributionToSats } from "@/modules/investments/domain/conversion";
import type { LightningGateway } from "@/modules/investments/domain/lightning-gateway";

const INVOICE_TTL_SECONDS = 15 * 60;
const MAX_INVOICES = 8;

export function usdToMinor(amountUsd: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amountUsd);
  if (!match) throw new Error("Enter a donation amount");
  const cents = (match[2] ?? "").padEnd(2, "0");
  return BigInt(match[1] ?? "0") * 100n + BigInt(cents);
}

export async function createDonationLightningInvoice(
  prisma: PrismaClient,
  prices: CachedPriceService,
  lightning: LightningGateway,
  command: { donationRequestId: string; amountUsd: string; webhookUrl: string },
) {
  const donation = await prisma.donationRequest.findUnique({ where: { id: command.donationRequestId } });
  if (!donation) throw new Error("Donation not found");
  if (donation.status === "SUCCEEDED") throw new Error("This donation is already complete");

  const amountUsdMinor = usdToMinor(command.amountUsd);
  if (amountUsdMinor <= 0n || amountUsdMinor > 10_000_000n) throw new Error("Enter a donation amount");

  const reusable = await prisma.donationLightningInvoice.findFirst({
    where: {
      donationRequestId: donation.id,
      status: "NEW",
      amountUsdMinor,
      expiresAt: { gt: new Date(Date.now() + 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (reusable) return reusable;

  const createdCount = await prisma.donationLightningInvoice.count({ where: { donationRequestId: donation.id } });
  if (createdCount >= MAX_INVOICES) throw new Error("Too many Bitcoin invoices for this donation");

  const btcUsd = await prices.getPrice({ base: "BTC", quote: "USD" }, "TRANSACTION");
  const amountSats = contributionToSats({ amountMinor: amountUsdMinor, currencyCode: "USD", btcUsd: btcUsd.price });
  if (amountSats < 1n) throw new Error("That amount is too small for a Bitcoin payment");

  const created = await lightning.createInvoice({
    amountSats,
    memo: "Donation to Jumpstart",
    expiresInSeconds: INVOICE_TTL_SECONDS,
    webhookUrl: command.webhookUrl,
    externalId: donation.id,
  });

  return prisma.$transaction(async (transaction) => {
    await transaction.donationRequest.update({
      where: { id: donation.id },
      data: { amountUsdMinor, amountSats },
    });
    return transaction.donationLightningInvoice.create({
      data: {
        donationRequestId: donation.id,
        provider: lightning.name,
        providerInvoiceId: created.providerInvoiceId,
        bolt11: created.bolt11,
        paymentHash: created.paymentHash,
        amountUsdMinor,
        amountSats,
        expiresAt: created.expiresAt,
      },
    });
  });
}

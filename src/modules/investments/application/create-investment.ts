import type { PrismaClient } from "@prisma/client";

import type { CachedPriceService } from "@/modules/pricing/application/cached-price-service";
import type { LightningGateway } from "../domain/lightning-gateway";
import { contributionToSats } from "../domain/conversion";

export async function createInvestment(
  prisma: PrismaClient,
  prices: { crypto: CachedPriceService; forex: CachedPriceService },
  lightning: LightningGateway,
  command: {
    userId: string;
    organizationId: string;
    amountMinor: bigint;
    currencyCode: "UGX" | "USD";
    idempotencyKey: string;
    webhookUrl: string;
  },
) {
  const access = await prisma.investorOrganizationAccess.findFirst({
    where: { investor: { userId: command.userId }, organizationId: command.organizationId, status: "ACTIVE" },
    include: { investor: true, organization: { select: { name: true } } },
  });
  if (!access) throw new Error("Active investor access is required for this organization");

  const btcUsd = await prices.crypto.getPrice({ base: "BTC", quote: "USD" }, "TRANSACTION");
  const usdUgx = command.currencyCode === "UGX"
    ? await prices.forex.getPrice({ base: "USD", quote: "UGX" }, "TRANSACTION")
    : null;
  const amountSats = contributionToSats({ amountMinor: command.amountMinor, currencyCode: command.currencyCode, btcUsd: btcUsd.price, usdUgx: usdUgx?.price });
  const snapshot = await prisma.priceSnapshot.findFirstOrThrow({
    where: { baseCode: "BTC", quoteCode: "USD", observedAt: btcUsd.observedAt },
    orderBy: { createdAt: "desc" },
  });

  const commitment = await prisma.investmentCommitment.upsert({
    where: { idempotencyKey: command.idempotencyKey },
    update: {},
    create: {
      investorId: access.investorId,
      accessId: access.id,
      organizationId: access.organizationId,
      contributionCurrency: command.currencyCode,
      contributionAmountMinor: command.amountMinor,
      amountSats,
      priceSnapshotId: snapshot.id,
      status: "AWAITING_INVOICE",
      idempotencyKey: command.idempotencyKey,
    },
    include: { invoice: true },
  });
  if (commitment.invoice) return commitment;

  const created = await lightning.createInvoice({
    amountSats,
    memo: `Investment in ${access.organization.name}`,
    expiresInSeconds: 15 * 60,
    webhookUrl: command.webhookUrl,
    externalId: commitment.id,
  });

  return prisma.$transaction(async (transaction) => {
    await transaction.lightningInvoice.create({
      data: {
        commitmentId: commitment.id,
        provider: lightning.name,
        providerInvoiceId: created.providerInvoiceId,
        bolt11: created.bolt11,
        paymentHash: created.paymentHash,
        amountSats,
        expiresAt: created.expiresAt,
      },
    });
    return transaction.investmentCommitment.update({ where: { id: commitment.id }, data: { status: "AWAITING_PAYMENT" }, include: { invoice: true } });
  });
}
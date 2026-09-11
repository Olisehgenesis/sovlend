import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLightningGateway } from "@/modules/investments/infrastructure/create-lightning-gateway";
import { settleLightningInvoice } from "@/modules/investments/application/settle-lightning-invoice";

/**
 * Self-service settlement check for an investor's own commitment. Blink's webhook (see
 * /api/lightning/webhook) is the primary settlement path, but while BLINK_WEBHOOK_SECRET is
 * unavailable (or in case a webhook delivery is dropped/delayed), this lets the investor pull
 * settlement status directly from Blink instead of being stuck at "awaiting payment" forever.
 * Reuses the same idempotent `settleLightningInvoice` guard the webhook uses, so a webhook
 * delivery and a manual check racing each other can never double-credit the investor.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const investor = await prisma.investorProfile.findUnique({ where: { userId: session.user.id } });
  if (!investor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const commitment = await prisma.investmentCommitment.findFirst({ where: { id, investorId: investor.id }, include: { invoice: true } });
  if (!commitment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!commitment.invoice || commitment.invoice.status === "PAID" || !commitment.invoice.paymentHash) {
    return NextResponse.json({ status: commitment.status });
  }

  const gateway = createLightningGateway();
  if (!gateway) return NextResponse.json({ error: "Lightning gateway is not configured" }, { status: 503 });

  const settled = await gateway.isSettled(commitment.invoice.paymentHash);
  if (settled) await settleLightningInvoice(prisma, commitment.invoice, commitment.invoice.paymentHash);

  const refreshed = await prisma.investmentCommitment.findUniqueOrThrow({ where: { id }, select: { status: true } });
  return NextResponse.json({ status: refreshed.status });
}

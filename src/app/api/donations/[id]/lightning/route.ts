import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createDonationLightningInvoice } from "@/modules/donations/application/create-donation-lightning-invoice";
import { settleDonationLightningInvoice } from "@/modules/donations/application/settle-donation-lightning-invoice";
import { createLightningGateway } from "@/modules/investments/infrastructure/create-lightning-gateway";
import { PriceUnavailableError } from "@/modules/pricing/application/price-aggregator";
import { createPriceService } from "@/modules/pricing/infrastructure/create-price-service";

const amountSchema = z.object({
  amountUsd: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function invoiceJson(invoice: { id: string; bolt11: string; expiresAt: Date; amountSats: bigint; status: string }) {
  return {
    id: invoice.id,
    status: invoice.status,
    amountSats: invoice.amountSats.toString(),
    bolt11: invoice.bolt11,
    expiresAt: invoice.expiresAt,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Donation not found" }, { status: 404 });

  const parsed = amountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a donation amount" }, { status: 400 });

  const baseUrl = process.env.BETTER_AUTH_URL;
  const lightning = createLightningGateway();
  if (!baseUrl || !lightning) return NextResponse.json({ error: "Bitcoin payments are not available right now" }, { status: 503 });

  try {
    const invoice = await createDonationLightningInvoice(prisma, createPriceService({ base: "BTC", quote: "USD" }), lightning, {
      donationRequestId: id,
      amountUsd: parsed.data.amountUsd,
      webhookUrl: `${baseUrl}/api/lightning/webhook`,
    });
    return NextResponse.json(invoiceJson(invoice), { status: 201 });
  } catch (error) {
    if (error instanceof PriceUnavailableError) {
      return NextResponse.json({ error: "The Bitcoin price is temporarily unavailable. Try again shortly." }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Bitcoin invoice could not be created";
    const status = message === "Donation not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Donation not found" }, { status: 404 });

  const invoice = await prisma.donationLightningInvoice.findFirst({
    where: { donationRequestId: id },
    orderBy: { createdAt: "desc" },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  if (invoice.status === "NEW" && invoice.paymentHash && invoice.expiresAt.getTime() > Date.now() - 5 * 60_000) {
    const gateway = createLightningGateway();
    if (gateway && (await gateway.isSettled(invoice.paymentHash))) {
      await settleDonationLightningInvoice(prisma, invoice);
    }
  }

  const fresh = await prisma.donationLightningInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  return NextResponse.json(invoiceJson(fresh));
}

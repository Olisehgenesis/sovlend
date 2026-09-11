import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createLightningGateway } from "@/modules/investments/infrastructure/create-lightning-gateway";
import { settleLightningInvoice } from "@/modules/investments/application/settle-lightning-invoice";

/**
 * Blink webhook payload shape (dev.blink.sv/api/webhooks). We only care about the receive events
 * (an incoming payment settling); send/onchain events are irrelevant to investor funding.
 * `status` is lowercase in Blink's webhook examples ("success") even though GraphQL query
 * responses use uppercase-style enums, so we compare case-insensitively.
 */
const blinkWebhookSchema = z.object({
  eventType: z.string(),
  transaction: z.object({
    status: z.string(),
    initiationVia: z.object({ paymentHash: z.string().optional() }).passthrough(),
  }),
});

const RECEIVE_EVENT_TYPES = new Set(["receive.lightning", "receive.intraledger"]);

export async function POST(request: Request) {
  const rawBody = await request.text();

  const webhookSecret = process.env.BLINK_WEBHOOK_SECRET;
  if (!webhookSecret) return NextResponse.json({ error: "Gateway unavailable" }, { status: 503 });

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return NextResponse.json({ error: "Missing signature headers" }, { status: 400 });

  try {
    new Webhook(webhookSecret).verify(rawBody, { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": svixSignature });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const payload = blinkWebhookSchema.parse(JSON.parse(rawBody));
  if (!RECEIVE_EVENT_TYPES.has(payload.eventType)) return NextResponse.json({ received: true });

  const paymentHash = payload.transaction.initiationVia.paymentHash;
  if (!paymentHash) return NextResponse.json({ received: true });

  const invoice = await prisma.lightningInvoice.findUnique({ where: { paymentHash } });
  if (!invoice) return NextResponse.json({ received: true });
  if (invoice.status === "PAID") return NextResponse.json({ received: true });

  const settled = payload.transaction.status.toUpperCase() === "SUCCESS";
  if (!settled) {
    // Fall back to an explicit settlement check in case Blink ever sends this webhook for a
    // pending/failed state -- keeps this handler correct even if that assumption changes.
    const gateway = createLightningGateway();
    const confirmedSettled = gateway ? await gateway.isSettled(paymentHash) : false;
    if (!confirmedSettled) return NextResponse.json({ received: true });
  }

  await settleLightningInvoice(prisma, invoice, paymentHash);

  return NextResponse.json({ received: true });
}
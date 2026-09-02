import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { LnbitsGateway } from "@/modules/investments/infrastructure/lnbits-gateway";

const webhookSchema = z.object({ payment_hash: z.string().min(16) });

export async function POST(request: Request) {
  const payload = webhookSchema.parse(await request.json());
  const invoice = await prisma.lightningInvoice.findUnique({ where: { paymentHash: payload.payment_hash } });
  if (!invoice) return NextResponse.json({ received: true });
  if (invoice.status === "PAID") return NextResponse.json({ received: true });

  const lnbitsUrl = process.env.LNBITS_BASE_URL;
  const lnbitsKey = process.env.LNBITS_INVOICE_KEY;
  if (!lnbitsUrl || !lnbitsKey) return NextResponse.json({ error: "Gateway unavailable" }, { status: 503 });
  const settled = await new LnbitsGateway(lnbitsUrl, lnbitsKey).isSettled(payload.payment_hash);
  if (!settled) return NextResponse.json({ received: true });

  await prisma.$transaction(async (transaction) => {
    const changed = await transaction.lightningInvoice.updateMany({
      where: { id: invoice.id, status: "NEW" },
      data: { status: "PAID", settledAt: new Date() },
    });
    if (changed.count !== 1) return;
    await transaction.investmentCommitment.update({ where: { id: invoice.commitmentId }, data: { status: "SETTLEMENT_PENDING" } });
    await transaction.outboxEvent.create({ data: { aggregateType: "InvestmentCommitment", aggregateId: invoice.commitmentId, eventType: "investment.lightning.received", payload: { commitmentId: invoice.commitmentId, amountSats: invoice.amountSats.toString(), paymentHash: payload.payment_hash } } });
  });

  return NextResponse.json({ received: true });
}
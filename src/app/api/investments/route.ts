import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createInvestment } from "@/modules/investments/application/create-investment";
import { createLightningGateway } from "@/modules/investments/infrastructure/create-lightning-gateway";
import { PriceUnavailableError } from "@/modules/pricing/application/price-aggregator";
import { createPriceService } from "@/modules/pricing/infrastructure/create-price-service";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  currencyCode: z.enum(["UGX", "USD"]),
  amountMinor: z.string().regex(/^\d+$/),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = requestSchema.parse(await request.json());
  const baseUrl = process.env.BETTER_AUTH_URL;
  const lightning = createLightningGateway();
  if (!baseUrl || !lightning) return NextResponse.json({ error: "Lightning gateway is not configured" }, { status: 503 });

  try {
    const investment = await createInvestment(
      prisma,
      {
        crypto: createPriceService({ base: "BTC", quote: "USD" }),
        forex: createPriceService({ base: "USD", quote: "UGX" }),
      },
      lightning,
      {
        userId: session.user.id,
        organizationId: input.organizationId,
        currencyCode: input.currencyCode,
        amountMinor: BigInt(input.amountMinor),
        idempotencyKey: input.idempotencyKey,
        webhookUrl: `${baseUrl}/api/lightning/webhook`,
      },
    );

    return NextResponse.json({
      id: investment.id,
      status: investment.status,
      amountSats: investment.amountSats.toString(),
      invoice: investment.invoice ? { bolt11: investment.invoice.bolt11, expiresAt: investment.invoice.expiresAt } : null,
    });
  } catch (error) {
    if (error instanceof PriceUnavailableError) return NextResponse.json({ error: "Price is temporarily unavailable -- please try again shortly" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Investment invoice could not be created" }, { status: 400 });
  }
}

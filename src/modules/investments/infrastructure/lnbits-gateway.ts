import { z } from "zod";

import type { CreatedLightningInvoice, LightningGateway, LightningInvoiceRequest } from "../domain/lightning-gateway";

const invoiceSchema = z.object({ payment_hash: z.string(), payment_request: z.string() });
const statusSchema = z.object({ paid: z.boolean() });

export class LnbitsGateway implements LightningGateway {
  readonly name = "lnbits";

  constructor(private readonly baseUrl: string, private readonly invoiceKey: string) {}

  async createInvoice(request: LightningInvoiceRequest): Promise<CreatedLightningInvoice> {
    const response = await fetch(new URL("api/v1/payments", normalizedBase(this.baseUrl)), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": this.invoiceKey },
      body: JSON.stringify({
        out: false,
        amount: Number(request.amountSats),
        memo: request.memo,
        expiry: request.expiresInSeconds,
        webhook: request.webhookUrl,
        extra: { externalId: request.externalId },
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`LNbits invoice failed with HTTP ${response.status}`);
    const invoice = invoiceSchema.parse(await response.json());
    return {
      providerInvoiceId: invoice.payment_hash,
      paymentHash: invoice.payment_hash,
      bolt11: invoice.payment_request,
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1_000),
    };
  }

  async isSettled(paymentHash: string): Promise<boolean> {
    const response = await fetch(new URL(`api/v1/payments/${encodeURIComponent(paymentHash)}`, normalizedBase(this.baseUrl)), {
      headers: { "X-Api-Key": this.invoiceKey },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`LNbits status failed with HTTP ${response.status}`);
    return statusSchema.parse(await response.json()).paid;
  }
}

function normalizedBase(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
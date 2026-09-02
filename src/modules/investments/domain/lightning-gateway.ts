export type LightningInvoiceRequest = Readonly<{
  amountSats: bigint;
  memo: string;
  expiresInSeconds: number;
  webhookUrl: string;
  externalId: string;
}>;

export type CreatedLightningInvoice = Readonly<{
  providerInvoiceId: string;
  paymentHash: string;
  bolt11: string;
  expiresAt: Date;
}>;

export interface LightningGateway {
  readonly name: string;
  createInvoice(request: LightningInvoiceRequest): Promise<CreatedLightningInvoice>;
  isSettled(paymentHash: string): Promise<boolean>;
}
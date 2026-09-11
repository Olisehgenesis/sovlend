import { z } from "zod";

import type { CreatedLightningInvoice, LightningGateway, LightningInvoiceRequest } from "../domain/lightning-gateway";

const DEFAULT_API_URL = "https://api.blink.sv/graphql";

const invoiceResponseSchema = z.object({
  data: z.object({
    lnInvoiceCreate: z.object({
      invoice: z.object({ paymentRequest: z.string(), paymentHash: z.string(), satoshis: z.number() }).nullable(),
      errors: z.array(z.object({ message: z.string() })),
    }),
  }),
});

const transactionsResponseSchema = z.object({
  data: z.object({
    me: z.object({
      defaultAccount: z.object({
        transactions: z.object({
          edges: z.array(
            z.object({
              node: z.object({
                status: z.string(),
                initiationVia: z.object({ paymentHash: z.string().optional() }).passthrough(),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

/**
 * Blink (dev.blink.sv) Lightning gateway -- SovLend's chosen payout/receive rail (see
 * docs/btc-integration-plan.md §6A on the beta branch). Talks to Blink's GraphQL API using a
 * server-side API key with Receive+Write scope: `lnInvoiceCreate` to generate invoices for
 * investor/manager/owner funding, and a transactions-list lookup as an isSettled fallback for
 * when the webhook (see /api/lightning/webhook) hasn't arrived yet.
 */
export class BlinkGateway implements LightningGateway {
  readonly name = "blink";

  constructor(
    private readonly apiKey: string,
    private readonly walletId: string,
    private readonly apiUrl: string = DEFAULT_API_URL,
  ) {}

  async createInvoice(request: LightningInvoiceRequest): Promise<CreatedLightningInvoice> {
    const response = await this.graphql(
      `mutation LnInvoiceCreate($input: LnInvoiceCreateInput!) {
        lnInvoiceCreate(input: $input) {
          invoice { paymentRequest paymentHash satoshis }
          errors { message }
        }
      }`,
      {
        input: {
          walletId: this.walletId,
          amount: Number(request.amountSats),
          memo: request.memo,
          expiresIn: Math.max(1, Math.round(request.expiresInSeconds / 60)),
        },
      },
    );
    const parsed = invoiceResponseSchema.parse(await response.json()).data.lnInvoiceCreate;
    if (parsed.errors.length > 0) throw new Error(`Blink invoice failed: ${parsed.errors.map((error) => error.message).join("; ")}`);
    if (!parsed.invoice) throw new Error("Blink invoice failed: no invoice returned");
    return {
      providerInvoiceId: parsed.invoice.paymentHash,
      paymentHash: parsed.invoice.paymentHash,
      bolt11: parsed.invoice.paymentRequest,
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1_000),
    };
  }

  /** Fallback poll for when the webhook hasn't landed yet -- scans the account's recent
   * transactions for a matching payment hash with a successful settlement status. The webhook
   * (§2 of the Blink integration) is the primary confirmation path; this exists so an operator
   * can manually re-check a specific invoice without waiting on webhook delivery/retries. */
  async isSettled(paymentHash: string): Promise<boolean> {
    const response = await this.graphql(
      `query RecentTransactions($first: Int!) {
        me {
          defaultAccount {
            transactions(first: $first) {
              edges { node { status initiationVia { ... on InitiationViaLn { paymentHash } } } }
            }
          }
        }
      }`,
      { first: 50 },
    );
    const transactions = transactionsResponseSchema.parse(await response.json()).data.me.defaultAccount.transactions.edges;
    const match = transactions.find((edge) => edge.node.initiationVia.paymentHash === paymentHash);
    return match?.node.status.toUpperCase() === "SUCCESS";
  }

  private async graphql(query: string, variables: Record<string, unknown>) {
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": this.apiKey },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Blink API failed with HTTP ${response.status}`);
    return response;
  }
}

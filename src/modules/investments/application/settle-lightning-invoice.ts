import type { PrismaClient } from "@prisma/client";

type SettleableInvoice = { id: string; commitmentId: string; amountSats: bigint };

/**
 * Idempotently transitions a Lightning invoice + its investment commitment from NEW to
 * PAID/SETTLEMENT_PENDING. Guarded by an `updateMany` scoped to `status: "NEW"`, so this is safe
 * to call from both the Blink webhook handler and a manual, investor-triggered settlement check
 * (see /api/investments/[id]/check-status) without ever double-crediting an investor: whichever
 * caller wins the race flips the row first, the other sees `count !== 1` and no-ops.
 */
export async function settleLightningInvoice(prisma: PrismaClient, invoice: SettleableInvoice, paymentHash: string): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    const changed = await transaction.lightningInvoice.updateMany({
      where: { id: invoice.id, status: "NEW" },
      data: { status: "PAID", settledAt: new Date() },
    });
    if (changed.count !== 1) return false;
    await transaction.investmentCommitment.update({ where: { id: invoice.commitmentId }, data: { status: "SETTLEMENT_PENDING" } });
    await transaction.outboxEvent.create({
      data: {
        aggregateType: "InvestmentCommitment",
        aggregateId: invoice.commitmentId,
        eventType: "investment.lightning.received",
        payload: { commitmentId: invoice.commitmentId, amountSats: invoice.amountSats.toString(), paymentHash },
      },
    });
    return true;
  });
}

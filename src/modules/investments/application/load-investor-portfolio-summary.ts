import type { PrismaClient } from "@prisma/client";

/** Commitment statuses that represent money the investor has actually put in (as opposed to a
 * draft/pending invoice that may still expire or be cancelled). */
const FUNDED_LIKE_STATUSES = new Set(["SETTLEMENT_PENDING", "FUNDED"]);
const PENDING_STATUSES = new Set(["AWAITING_INVOICE", "AWAITING_PAYMENT"]);

export type InvestorPortfolioPoint = Readonly<{ date: string; cumulativeSats: string }>;

export type InvestorPortfolioSummary = Readonly<{
  memberSince: Date;
  businessCount: number;
  fundedCount: number;
  fundedSats: bigint;
  pendingCount: number;
  pendingSats: bigint;
  fundedByCurrency: ReadonlyArray<{ currencyCode: string; amountMinor: bigint }>;
  timeline: readonly InvestorPortfolioPoint[];
}>;

type PortfolioPrisma = Pick<PrismaClient, "investorProfile" | "investmentCommitment">;

/**
 * Deposit/investment overview for one investor: how much they have actually put in (funded,
 * across whichever currencies they contributed in), how much is still awaiting settlement, how
 * many distinct businesses they hold a position in, and a cumulative-sats timeline for a
 * portfolio-growth chart on the investor dashboard.
 */
export async function loadInvestorPortfolioSummary(prisma: PortfolioPrisma, investorId: string): Promise<InvestorPortfolioSummary> {
  const investor = await prisma.investorProfile.findUniqueOrThrow({ where: { id: investorId }, select: { createdAt: true } });
  const commitments = await prisma.investmentCommitment.findMany({
    where: { investorId },
    select: { status: true, amountSats: true, contributionCurrency: true, contributionAmountMinor: true, organizationId: true, fundedAt: true, createdAt: true },
  });

  let fundedSats = 0n;
  let pendingSats = 0n;
  let fundedCount = 0;
  let pendingCount = 0;
  const fundedByCurrency = new Map<string, bigint>();
  const businesses = new Set<string>();
  const fundedEvents: { date: Date; sats: bigint }[] = [];

  for (const commitment of commitments) {
    businesses.add(commitment.organizationId);
    if (FUNDED_LIKE_STATUSES.has(commitment.status)) {
      fundedSats += commitment.amountSats;
      fundedCount += 1;
      fundedByCurrency.set(commitment.contributionCurrency, (fundedByCurrency.get(commitment.contributionCurrency) ?? 0n) + commitment.contributionAmountMinor);
      fundedEvents.push({ date: commitment.fundedAt ?? commitment.createdAt, sats: commitment.amountSats });
    } else if (PENDING_STATUSES.has(commitment.status)) {
      pendingSats += commitment.amountSats;
      pendingCount += 1;
    }
  }

  fundedEvents.sort((a, b) => a.date.getTime() - b.date.getTime());
  let cumulative = 0n;
  const timeline = fundedEvents.map((event) => {
    cumulative += event.sats;
    return { date: event.date.toISOString().slice(0, 10), cumulativeSats: cumulative.toString() };
  });

  return {
    memberSince: investor.createdAt,
    businessCount: businesses.size,
    fundedCount,
    fundedSats,
    pendingCount,
    pendingSats,
    fundedByCurrency: Array.from(fundedByCurrency, ([currencyCode, amountMinor]) => ({ currencyCode, amountMinor })),
    timeline,
  };
}

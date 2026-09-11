import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { loadInvestorPortfolioSummary } from "./load-investor-portfolio-summary";

function buildPrisma(commitments: unknown[]) {
  const prisma = {
    investorProfile: { findUniqueOrThrow: async () => ({ createdAt: new Date("2026-01-01T00:00:00Z") }) },
    investmentCommitment: { findMany: async () => commitments },
  };
  return prisma as unknown as Pick<PrismaClient, "investorProfile" | "investmentCommitment">;
}

describe("loadInvestorPortfolioSummary", () => {
  it("splits funded vs pending, sums per-currency deposits, and builds a cumulative-sats timeline", async () => {
    const prisma = buildPrisma([
      { status: "FUNDED", amountSats: 100_000n, contributionCurrency: "UGX", contributionAmountMinor: 400_000_00n, organizationId: "org-1", fundedAt: new Date("2026-02-01"), createdAt: new Date("2026-01-15") },
      { status: "SETTLEMENT_PENDING", amountSats: 50_000n, contributionCurrency: "UGX", contributionAmountMinor: 200_000_00n, organizationId: "org-1", fundedAt: new Date("2026-03-01"), createdAt: new Date("2026-02-20") },
      { status: "AWAITING_PAYMENT", amountSats: 20_000n, contributionCurrency: "USD", contributionAmountMinor: 5_000n, organizationId: "org-2", fundedAt: null, createdAt: new Date("2026-03-05") },
      { status: "EXPIRED", amountSats: 10_000n, contributionCurrency: "USD", contributionAmountMinor: 2_500n, organizationId: "org-2", fundedAt: null, createdAt: new Date("2026-01-10") },
    ]);

    const summary = await loadInvestorPortfolioSummary(prisma, "investor-1");

    expect(summary.fundedCount).toBe(2);
    expect(summary.fundedSats).toBe(150_000n);
    expect(summary.pendingCount).toBe(1);
    expect(summary.pendingSats).toBe(20_000n);
    expect(summary.businessCount).toBe(2);
    expect(summary.fundedByCurrency).toEqual([{ currencyCode: "UGX", amountMinor: 600_000_00n }]);
    expect(summary.timeline).toEqual([
      { date: "2026-02-01", cumulativeSats: "100000" },
      { date: "2026-03-01", cumulativeSats: "150000" },
    ]);
  });

  it("returns zeroed totals and an empty timeline for a brand-new investor with no commitments", async () => {
    const prisma = buildPrisma([]);
    const summary = await loadInvestorPortfolioSummary(prisma, "investor-1");

    expect(summary.fundedCount).toBe(0);
    expect(summary.fundedSats).toBe(0n);
    expect(summary.pendingCount).toBe(0);
    expect(summary.businessCount).toBe(0);
    expect(summary.fundedByCurrency).toEqual([]);
    expect(summary.timeline).toEqual([]);
  });
});

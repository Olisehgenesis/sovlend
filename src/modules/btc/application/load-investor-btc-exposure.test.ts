import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/btc/infrastructure/onchain-balance-provider", () => ({
  fetchOnChainBalanceSats: vi.fn(async () => ({ balanceSats: 50_000n, fetchedAt: new Date() })),
}));

import { loadInvestorBtcExposure } from "./load-investor-btc-exposure";

function buildPrisma() {
  const prisma = {
    investorOrganizationAccess: {
      findMany: vi.fn(async () => [
        { organizationId: "org-1", organization: { id: "org-1", name: "Jump Start Africa" } },
      ]),
    },
    clientBtcAccount: {
      findMany: vi.fn(async () => [
        { balanceSource: "MANUAL", address: null, manualBalanceSats: 100_000n },
        { balanceSource: "ON_CHAIN_ADDRESS", address: "bc1qxyz", manualBalanceSats: 0n },
      ]),
    },
    investmentCommitment: {
      aggregate: vi.fn(async () => ({ _sum: { amountSats: 200_000n } })),
    },
    loan: {
      aggregate: vi.fn(async () => ({ _sum: { principalMinor: 900_000_000n } })),
    },
    priceSnapshot: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({ price: 60_000, status: "OK", observedAt: new Date() }) // BTC/USD
        .mockResolvedValueOnce({ price: 3_700, status: "OK", observedAt: new Date() }), // USD/UGX
    },
  };
  return prisma as unknown as Pick<PrismaClient, "investorOrganizationAccess" | "clientBtcAccount" | "investmentCommitment" | "loan" | "priceSnapshot">;
}

describe("loadInvestorBtcExposure", () => {
  it("combines client-held BTC, the investor's own funded sats, and the fiat portfolio per organization", async () => {
    const prisma = buildPrisma();
    const [exposure] = await loadInvestorBtcExposure(prisma, "investor-1");

    expect(exposure.organizationId).toBe("org-1");
    // 100,000 (manual) + 50,000 (mocked on-chain) = 150,000 client sats.
    expect(exposure.clientBtcSats).toBe(150_000n);
    expect(exposure.investorFundedSats).toBe(200_000n);
    expect(exposure.totalBtcSats).toBe(350_000n);
    expect(exposure.totalBtcUgxMinor).not.toBeNull();
    expect(exposure.fiatPortfolioMinor).toBe(900_000_000n);
    expect(exposure.fundsUnderManagementMinor).toBeGreaterThan(exposure.fiatPortfolioMinor);
    expect(exposure.btcExposureBps).toBeGreaterThan(0);
  });

  it("returns zero exposure percentage when there is no portfolio and no BTC price", async () => {
    const prisma = buildPrisma();
    (prisma.priceSnapshot.findFirst as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
    (prisma.loan.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { principalMinor: 0n } });
    (prisma.clientBtcAccount.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.investmentCommitment.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { amountSats: 0n } });

    const [exposure] = await loadInvestorBtcExposure(prisma, "investor-1");

    expect(exposure.totalBtcUgxMinor).toBeNull();
    expect(exposure.fundsUnderManagementMinor).toBe(0n);
    expect(exposure.btcExposureBps).toBe(0);
  });
});

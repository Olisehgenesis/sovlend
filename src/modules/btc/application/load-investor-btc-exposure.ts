import type { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";

import { OPEN_LOAN_STATUSES } from "@/modules/lending/application/client-wallet";
import { loadBtcUgxPrice } from "@/modules/btc/application/load-btc-price";
import { fetchOnChainBalanceSats } from "@/modules/btc/infrastructure/onchain-balance-provider";
import { satsToUgxMinor } from "@/modules/btc/domain/valuation";

export type InvestorOrgBtcExposure = {
  organizationId: string;
  organizationName: string;
  /** Every client BTC account balance recorded for this organization (Phase 1: read-only, no
   * real custody -- see docs/btc-integration-plan.md §7). */
  clientBtcSats: bigint;
  /** This investor's own funded Lightning contributions to this organization. */
  investorFundedSats: bigint;
  totalBtcSats: bigint;
  totalBtcUgxMinor: bigint | null;
  fiatPortfolioMinor: bigint;
  /** Funds under management, combining the fiat loan portfolio with the BTC exposure valued at
   * the current rate (0 when no fresh BTC/UGX price is available, so the total never silently
   * understates the portfolio). */
  fundsUnderManagementMinor: bigint;
  btcExposureBps: number;
};

/** Read-only summary of an investor's Bitcoin-denominated exposure across every organization they
 * hold ACTIVE access to -- combines client-held BTC balances (recorded on `ClientBtcAccount`) with
 * the investor's own funded Lightning contributions, alongside the organization's fiat loan
 * portfolio, so an investor can see how much of "their" business is BTC- vs. fiat-denominated.
 * Nothing here moves funds; it is a dashboard aggregate only (docs/btc-integration-plan.md §7). */
export async function loadInvestorBtcExposure(
  prisma: Pick<PrismaClient, "investorOrganizationAccess" | "clientBtcAccount" | "investmentCommitment" | "loan" | "priceSnapshot">,
  investorId: string,
): Promise<InvestorOrgBtcExposure[]> {
  const [accesses, btcPrice] = await Promise.all([
    prisma.investorOrganizationAccess.findMany({
      where: { investorId, status: "ACTIVE" },
      include: { organization: { select: { id: true, name: true } } },
    }),
    loadBtcUgxPrice(prisma),
  ]);

  return Promise.all(
    accesses.map(async (access) => {
      const organizationId = access.organizationId;
      const [clientAccounts, fundedCommitments, portfolio] = await Promise.all([
        prisma.clientBtcAccount.findMany({
          where: { organizationId, status: "ACTIVE" },
          select: { balanceSource: true, address: true, manualBalanceSats: true },
        }),
        prisma.investmentCommitment.aggregate({
          where: { investorId, organizationId, status: "FUNDED" },
          _sum: { amountSats: true },
        }),
        prisma.loan.aggregate({
          where: { office: { organizationId }, status: { in: [...OPEN_LOAN_STATUSES] } },
          _sum: { principalMinor: true },
        }),
      ]);

      const clientBtcSats = (
        await Promise.all(
          clientAccounts.map(async (account) => {
            if (account.balanceSource === "ON_CHAIN_ADDRESS" && account.address) {
              const resolved = await fetchOnChainBalanceSats(account.address);
              return resolved?.balanceSats ?? 0n;
            }
            return account.manualBalanceSats;
          }),
        )
      ).reduce((sum, sats) => sum + sats, 0n);

      const investorFundedSats = fundedCommitments._sum.amountSats ?? 0n;
      const totalBtcSats = clientBtcSats + investorFundedSats;
      const totalBtcUgxMinor = satsToUgxMinor(totalBtcSats, btcPrice?.priceUgx ?? null);
      const fiatPortfolioMinor = portfolio._sum.principalMinor ?? 0n;
      const fundsUnderManagementMinor = fiatPortfolioMinor + (totalBtcUgxMinor ?? 0n);
      const btcExposureBps =
        fundsUnderManagementMinor > 0n
          ? Number(new Decimal((totalBtcUgxMinor ?? 0n).toString()).mul(10_000).div(fundsUnderManagementMinor.toString()).toDecimalPlaces(0))
          : 0;

      return {
        organizationId,
        organizationName: access.organization.name,
        clientBtcSats,
        investorFundedSats,
        totalBtcSats,
        totalBtcUgxMinor,
        fiatPortfolioMinor,
        fundsUnderManagementMinor,
        btcExposureBps,
      };
    }),
  );
}

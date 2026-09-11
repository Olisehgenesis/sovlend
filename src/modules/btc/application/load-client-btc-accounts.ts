import type { PrismaClient } from "@prisma/client";

import { fetchOnChainBalanceSats } from "@/modules/btc/infrastructure/onchain-balance-provider";

export type ResolvedBtcAccount = {
  id: string;
  label: string;
  balanceSource: string;
  address: string | null;
  status: string;
  balanceSats: bigint;
  balanceUnavailable: boolean;
  balanceAsOf: Date | null;
  createdAt: Date;
};

/** Loads a client's BTC accounts and resolves each one's balance -- manual accounts read the
 * staff-recorded figure directly, on-chain-address accounts are read live from a public block
 * explorer (see onchain-balance-provider.ts). Every resolution is independent, so one slow or
 * unreachable address never blocks the others or throws for the whole client page. */
export async function loadClientBtcAccounts(
  prisma: Pick<PrismaClient, "clientBtcAccount">,
  clientId: string,
): Promise<ResolvedBtcAccount[]> {
  const accounts = await prisma.clientBtcAccount.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
  return Promise.all(
    accounts.map(async (account) => {
      if (account.balanceSource === "ON_CHAIN_ADDRESS" && account.address) {
        const resolved = await fetchOnChainBalanceSats(account.address);
        return {
          id: account.id,
          label: account.label,
          balanceSource: account.balanceSource,
          address: account.address,
          status: account.status,
          balanceSats: resolved?.balanceSats ?? 0n,
          balanceUnavailable: resolved === null,
          balanceAsOf: resolved?.fetchedAt ?? null,
          createdAt: account.createdAt,
        };
      }
      return {
        id: account.id,
        label: account.label,
        balanceSource: account.balanceSource,
        address: account.address,
        status: account.status,
        balanceSats: account.manualBalanceSats,
        balanceUnavailable: false,
        balanceAsOf: account.updatedAt,
        createdAt: account.createdAt,
      };
    }),
  );
}

import type { PrismaClient } from "@prisma/client";

/** Balance of each savings account, summed in the database. */
export async function sumSavingsByAccount(
  db: PrismaClient,
  accountIds: readonly string[],
): Promise<Map<string, bigint>> {
  const balances = new Map<string, bigint>();
  if (accountIds.length === 0) return balances;
  const rows = await db.savingsTransaction.groupBy({
    by: ["savingsAccountId"],
    where: { savingsAccountId: { in: [...accountIds] } },
    _sum: { amountMinor: true },
  });
  for (const row of rows) {
    balances.set(row.savingsAccountId, row._sum.amountMinor ?? 0n);
  }
  return balances;
}

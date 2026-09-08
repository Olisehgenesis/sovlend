import { prisma } from "@/lib/prisma";

/**
 * One-off, idempotent backfill: for every client that has at least one ACTIVE savings account
 * but none flagged `isDefault`, marks their oldest ACTIVE savings account as the default. This
 * is the account the standing-order sweep pulls from. New savings accounts opened going forward
 * should set `isDefault` explicitly (the account-opening flow is unaffected by this script).
 * Safe to re-run: only touches clients with zero accounts currently flagged default.
 */
async function main() {
  const clients = await prisma.client.findMany({
    where: {
      savingsAccounts: { some: { status: "ACTIVE" }, none: { isDefault: true } },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      savingsAccounts: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, accountNumber: true },
      },
    },
  });

  if (clients.length === 0) {
    console.log("Every client with an active savings account already has a default. Nothing to do.");
    return;
  }

  let updated = 0;
  for (const client of clients) {
    const oldest = client.savingsAccounts[0];
    if (!oldest) continue;
    await prisma.savingsAccount.update({ where: { id: oldest.id }, data: { isDefault: true } });
    updated += 1;
    console.log(`Set default savings account for ${client.firstName} ${client.lastName}: ${oldest.accountNumber}`);
  }

  console.log(`Done. Backfilled default savings account for ${updated} client(s).`);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

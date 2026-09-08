import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@/lib/prisma";

/**
 * One-off, idempotent data fix for the "no clients show up" gap reported for Loan Officers:
 * `backfill-officer-assignments.ts` populated `Loan.loanOfficerId` and
 * `SavingsAccount.fieldOfficerId` straight from the legacy Fineract API, but iLend's client and
 * group records have no staff field of their own (the legacy client detail screen literally
 * shows "Staff: Unassigned"), so `Client.assignedOfficerId` and `Group.staffId` were left null
 * for every record. Loan Officer scoping (`clientScopeWhere`/`groupScopeWhere`) filters on those
 * two columns, so an officer's Loans list was correctly scoped while their Clients/Groups lists
 * came back empty.
 *
 * This derives the "owning" officer for each client/group from their own loans and savings
 * accounts (the most frequent non-null officer among them, ties broken by most recent), so a
 * client/group shows up for whichever officer actually services their loans/savings -- mirroring
 * what the Loans list already displays. Groups fall back to the majority officer among their
 * member clients when the group has no loans/savings of its own.
 *
 * Safe to re-run: only ever assigns `assignedOfficerId`/`staffId` when currently null, and
 * recomputes the same "most frequent" answer each time from the same source rows.
 */

function pickMostFrequentOfficer(rows: readonly { officerId: string; createdAt: Date }[]): string | null {
  if (rows.length === 0) return null;

  const tally = new Map<string, { count: number; latest: Date }>();
  for (const row of rows) {
    const existing = tally.get(row.officerId);
    if (existing) {
      existing.count += 1;
      if (row.createdAt > existing.latest) existing.latest = row.createdAt;
    } else {
      tally.set(row.officerId, { count: 1, latest: row.createdAt });
    }
  }

  let best: { officerId: string; count: number; latest: Date } | null = null;
  for (const [officerId, stats] of tally) {
    if (!best || stats.count > best.count || (stats.count === best.count && stats.latest > best.latest)) {
      best = { officerId, count: stats.count, latest: stats.latest };
    }
  }
  return best?.officerId ?? null;
}

async function backfillClients() {
  const clients = await prisma.client.findMany({
    where: { assignedOfficerId: null },
    select: { id: true },
  });

  let updated = 0;
  for (const client of clients) {
    const [loans, savingsAccounts] = await Promise.all([
      prisma.loan.findMany({
        where: { clientId: client.id, loanOfficerId: { not: null } },
        select: { loanOfficerId: true, createdAt: true },
      }),
      prisma.savingsAccount.findMany({
        where: { clientId: client.id, fieldOfficerId: { not: null } },
        select: { fieldOfficerId: true, createdAt: true },
      }),
    ]);

    const rows = [
      ...loans.map((loan) => ({ officerId: loan.loanOfficerId as string, createdAt: loan.createdAt })),
      ...savingsAccounts.map((account) => ({ officerId: account.fieldOfficerId as string, createdAt: account.createdAt })),
    ];
    const officerId = pickMostFrequentOfficer(rows);
    if (!officerId) continue;

    await prisma.client.update({ where: { id: client.id }, data: { assignedOfficerId: officerId } });
    updated += 1;
  }

  console.log(`[backfill-client-group-officer] Clients: ${clients.length} candidates, ${updated} updated.`);
  return { candidates: clients.length, updated };
}

async function backfillGroups() {
  const groups = await prisma.group.findMany({
    where: { staffId: null },
    select: { id: true },
  });

  let updated = 0;
  for (const group of groups) {
    const [loans, savingsAccounts] = await Promise.all([
      prisma.loan.findMany({
        where: { groupId: group.id, loanOfficerId: { not: null } },
        select: { loanOfficerId: true, createdAt: true },
      }),
      prisma.savingsAccount.findMany({
        where: { groupId: group.id, fieldOfficerId: { not: null } },
        select: { fieldOfficerId: true, createdAt: true },
      }),
    ]);

    let rows = [
      ...loans.map((loan) => ({ officerId: loan.loanOfficerId as string, createdAt: loan.createdAt })),
      ...savingsAccounts.map((account) => ({ officerId: account.fieldOfficerId as string, createdAt: account.createdAt })),
    ];

    if (rows.length === 0) {
      // Fall back to the majority officer among the group's own member clients.
      const members = await prisma.groupMember.findMany({ where: { groupId: group.id }, select: { clientId: true } });
      const memberClients = await prisma.client.findMany({
        where: { id: { in: members.map((member) => member.clientId) }, assignedOfficerId: { not: null } },
        select: { assignedOfficerId: true, updatedAt: true },
      });
      rows = memberClients.map((client) => ({ officerId: client.assignedOfficerId as string, createdAt: client.updatedAt }));
    }

    const officerId = pickMostFrequentOfficer(rows);
    if (!officerId) continue;

    await prisma.group.update({ where: { id: group.id }, data: { staffId: officerId } });
    updated += 1;
  }

  console.log(`[backfill-client-group-officer] Groups: ${groups.length} candidates, ${updated} updated.`);
  return { candidates: groups.length, updated };
}

export async function backfillClientAndGroupOfficers() {
  // Clients first, so the Group fallback (member-client majority) has fresh data to read from.
  const clientResult = await backfillClients();
  const groupResult = await backfillGroups();
  return { clients: clientResult, groups: groupResult };
}

async function main() {
  const result = await backfillClientAndGroupOfficers();
  console.log("Done.", JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

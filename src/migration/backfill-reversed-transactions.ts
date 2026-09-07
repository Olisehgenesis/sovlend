import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

/**
 * One-time backfill for legacy-imported LoanTransaction rows that Fineract had already
 * marked `manuallyReversed: true` at export time.
 *
 * The original import-archive-loans.ts script imported every transaction in the raw
 * archive unconditionally and never looked at `manuallyReversed`, so these reversed
 * transactions were left looking "live" (reversedById = null). Every downstream consumer
 * that filters on `!reversedById` (loan detail page, collected-today/disbursed-today
 * reports, risk report, loan export) was therefore double-counting them — found while
 * cross-checking iLend's production "Total Paid" figures against our own transaction
 * totals (iLend already nets these out server-side via Fineract's own totals).
 *
 * This creates a synthetic `*.reversal` LoanTransaction for each affected original (mirroring
 * the shape used by the live reversal workflow in loan-service-actions.ts) and links it via
 * reversedById, so existing `!reversedById` filters correctly exclude the original from any
 * totals from this point on. No accounting/journal entries are touched: the legacy import
 * never posted journals for these transactions in the first place.
 *
 * Reads from the already-downloaded legacy archive on disk (no live iLend calls), so this
 * is safe to run repeatedly (idempotent — skips originals that are already reversed) and does
 * not touch the production iLend system.
 *
 * Usage: tsx src/migration/backfill-reversed-transactions.ts <path-to-archive-root>
 * e.g.:  tsx src/migration/backfill-reversed-transactions.ts .migration-data/ilend-sync-2026-09-03T18-55-43-804Z
 */

function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value as number[];
  return new Date(Date.UTC(year, month - 1, day));
}

async function main() {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: tsx src/migration/backfill-reversed-transactions.ts <path-to-archive-root>");
    process.exitCode = 1;
    return;
  }

  const folder = path.join(root, "raw", "loans");
  const files = (await readdir(folder)).filter((entry) => entry.endsWith(".json"));

  let reversedCount = 0;
  let alreadyReversed = 0;
  let notFound = 0;

  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(folder, file), "utf8")) as Record<string, unknown>;
    const legacyLoanId = Number(payload.id);
    const transactions = (payload.transactions as Array<Record<string, unknown>>) ?? [];

    for (const txn of transactions) {
      if (!txn.manuallyReversed) continue;

      const externalReference = `legacy:${legacyLoanId}:${txn.id}`;
      const original = await prisma.loanTransaction.findFirst({
        where: { externalReference },
        select: { id: true, loanId: true, transactionType: true, businessDate: true, settlementCurrency: true, settlementChannel: true, settlementAccountId: true, settlementAmountMinor: true, denominationAmountMinor: true, reversedById: true },
      });

      if (!original) {
        notFound += 1;
        console.log(`No local transaction found for ${externalReference}`);
        continue;
      }
      if (original.reversedById) {
        alreadyReversed += 1;
        continue;
      }

      const reversalIdempotencyKey = `legacy-loan-${legacyLoanId}-txn-${txn.id}-reversal`;
      const reversal = await prisma.loanTransaction.create({
        data: {
          loanId: original.loanId,
          transactionType: `${original.transactionType}.reversal`,
          businessDate: dateFromParts(txn.date) ?? original.businessDate,
          settlementCurrency: original.settlementCurrency,
          settlementChannel: original.settlementChannel,
          settlementAccountId: original.settlementAccountId,
          settlementAmountMinor: original.settlementAmountMinor,
          denominationAmountMinor: original.denominationAmountMinor,
          externalReference: `${externalReference}:reversal`,
          idempotencyKey: reversalIdempotencyKey,
        },
      });
      await prisma.loanTransaction.update({ where: { id: original.id }, data: { reversedById: reversal.id } });
      reversedCount += 1;
    }
  }

  console.log(`Linked ${reversedCount} legacy transaction(s) to a synthetic reversal record.`);
  if (alreadyReversed > 0) console.log(`${alreadyReversed} were already reversed (skipped, idempotent re-run).`);
  if (notFound > 0) console.log(`${notFound} referenced in the archive had no matching local transaction (possibly a loan that failed to import).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

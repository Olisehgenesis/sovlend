import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

/**
 * One-time backfill for Loan.writtenOffOn / Loan.writtenOffByName.
 *
 * Fineract's raw loan payload carries this under timeline.writeOffOnDate /
 * timeline.writeOffByFirstname / timeline.writeOffByLastname, which the original
 * import scripts never mapped. This mirrors iLend's "Written Off By" column on the
 * Loans Written Off list (see /account/loanswrittenoff).
 *
 * Reads from the already-downloaded legacy archive on disk (no live iLend calls), so this
 * is safe to run repeatedly and does not touch the production iLend system.
 *
 * Usage: tsx src/migration/backfill-loan-writeoff-metadata.ts <path-to-archive-root>
 * e.g.:  tsx src/migration/backfill-loan-writeoff-metadata.ts .migration-data/ilend-sync-2026-09-03T18-55-43-804Z
 */

function toDateOnly(parts: unknown): Date | null {
  if (!Array.isArray(parts) || parts.length < 3) return null;
  const [year, month, day] = parts as number[];
  return new Date(Date.UTC(year, month - 1, day));
}

async function main() {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: tsx src/migration/backfill-loan-writeoff-metadata.ts <path-to-archive-root>");
    process.exitCode = 1;
    return;
  }

  const folder = path.join(root, "raw", "loans");
  const files = (await readdir(folder)).filter((entry) => entry.endsWith(".json"));

  const writtenOffLoans = await prisma.loan.findMany({
    where: { status: "WRITTEN_OFF", writtenOffOn: null, writtenOffByName: null },
    select: { id: true, accountNumber: true },
  });
  const byAccountNumber = new Map(writtenOffLoans.map((loan) => [loan.accountNumber, loan]));

  let updated = 0;
  const missing: string[] = [];

  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(folder, file), "utf8")) as Record<string, unknown>;
    const legacyLoanId = Number(payload.id);
    const accountNumber = `LEGACY-${legacyLoanId}`;
    const localLoan = byAccountNumber.get(accountNumber);
    if (!localLoan) continue;

    const timeline = (payload.timeline ?? {}) as Record<string, unknown>;
    const writtenOffOn = toDateOnly(timeline.writeOffOnDate);
    // iLend's "Written Off By" column displays the acting username (e.g. "PaybillAPI" for
    // system-driven write-offs, or a staff username), not the first/last display name.
    const writtenOffByName = (timeline.writeOffByUsername as string | undefined)?.trim() || null;

    if (!writtenOffOn && !writtenOffByName) continue;

    await prisma.loan.update({
      where: { id: localLoan.id },
      data: { writtenOffOn, writtenOffByName },
    });
    updated += 1;
    byAccountNumber.delete(accountNumber);
  }

  for (const remaining of byAccountNumber.values()) missing.push(remaining.accountNumber);

  console.log(`Backfilled ${updated} written-off loan(s) with write-off metadata from ${folder}`);
  if (missing.length > 0) {
    console.log(`${missing.length} written-off loan(s) had no archive record or no write-off metadata: ${missing.join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

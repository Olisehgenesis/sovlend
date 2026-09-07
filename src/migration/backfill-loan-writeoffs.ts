import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import Decimal from "decimal.js";

import { prisma } from "@/lib/prisma";

/**
 * One-time backfill (two phases) for the "written off loans show wrong outstanding" bug
 * (see src/modules/lending/domain/loan-outstanding.ts):
 *
 *  1. Fills Loan.{principal,interest,fees,penalties}WrittenOffMinor for loans imported as
 *     WRITTEN_OFF before those columns existed -- the import scripts previously discarded
 *     Fineract's summary.*WrittenOff figures entirely.
 *  2. Fills LoanInstallment.{principal,interest,fees,penalties}WaivedMinor for ANY loan
 *     (not just written-off ones) -- the import scripts also never mapped
 *     period.*Waived, so any loan with a waived charge/interest/penalty understated its
 *     true paid+waived coverage.
 *
 * Reads from the already-downloaded legacy archive on disk (no live iLend calls), so this
 * is safe to run repeatedly and does not touch the production iLend system.
 *
 * Usage: tsx src/migration/backfill-loan-writeoffs.ts <path-to-archive-root>
 * e.g.:  tsx src/migration/backfill-loan-writeoffs.ts .migration-data/ilend-sync-2026-09-03T18-55-43-804Z
 */

function toMinor(amount: number, exponent = 2): bigint {
  return BigInt(new Decimal(amount).mul(new Decimal(10).pow(exponent)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

async function main() {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: tsx src/migration/backfill-loan-writeoffs.ts <path-to-archive-root>");
    process.exitCode = 1;
    return;
  }

  const folder = path.join(root, "raw", "loans");
  const files = (await readdir(folder)).filter((entry) => entry.endsWith(".json"));

  const writtenOffLoans = await prisma.loan.findMany({
    where: {
      status: "WRITTEN_OFF",
      principalWrittenOffMinor: 0n,
      interestWrittenOffMinor: 0n,
      feesWrittenOffMinor: 0n,
      penaltiesWrittenOffMinor: 0n,
    },
    select: { id: true, accountNumber: true },
  });
  const byAccountNumber = new Map(writtenOffLoans.map((loan) => [loan.accountNumber, loan]));

  // Phase 1: loan-level write-off amounts (only meaningful for WRITTEN_OFF loans).
  let updated = 0;
  const missing: string[] = [];

  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(folder, file), "utf8")) as Record<string, unknown>;
    const legacyLoanId = Number(payload.id);
    const accountNumber = `LEGACY-${legacyLoanId}`;
    const localLoan = byAccountNumber.get(accountNumber);
    if (!localLoan) continue;

    const summary = (payload.summary ?? {}) as Record<string, unknown>;
    const currency = (payload.currency ?? {}) as Record<string, unknown>;
    const exponent = Number(currency.decimalPlaces ?? 2);

    const principalWrittenOffMinor = toMinor(Number(summary.principalWrittenOff ?? 0), exponent);
    const interestWrittenOffMinor = toMinor(Number(summary.interestWrittenOff ?? 0), exponent);
    const feesWrittenOffMinor = toMinor(Number(summary.feeChargesWrittenOff ?? 0), exponent);
    const penaltiesWrittenOffMinor = toMinor(Number(summary.penaltyChargesWrittenOff ?? 0), exponent);

    if (principalWrittenOffMinor + interestWrittenOffMinor + feesWrittenOffMinor + penaltiesWrittenOffMinor === 0n) continue;

    await prisma.loan.update({
      where: { id: localLoan.id },
      data: { principalWrittenOffMinor, interestWrittenOffMinor, feesWrittenOffMinor, penaltiesWrittenOffMinor },
    });
    updated += 1;
    byAccountNumber.delete(accountNumber);
  }

  const alreadyBackfilled = writtenOffLoans.length - updated - byAccountNumber.size;
  for (const remaining of byAccountNumber.values()) missing.push(remaining.accountNumber);

  console.log(`Backfilled ${updated} written-off loan(s) from ${folder}`);
  if (alreadyBackfilled > 0) console.log(`${alreadyBackfilled} loan(s) already had write-off amounts (skipped)`);
  if (missing.length > 0) console.log(`${missing.length} written-off loan(s) had no archive record or zero write-off in Fineract: ${missing.join(", ")}`);

  // Phase 2: per-installment waived amounts, for ALL loans (not just written off) --
  // the import scripts historically never mapped period.*Waived at all, so any loan with a
  // waived charge/interest/penalty currently understates its true paid+waived coverage.
  // Only touches installments that are still all-zero on waived columns (idempotent).
  const allLoans = await prisma.loan.findMany({ select: { id: true, accountNumber: true } });
  const allLoansByAccountNumber = new Map(allLoans.map((loan) => [loan.accountNumber, loan]));

  let installmentsUpdated = 0;
  let loansWithWaivedBackfilled = 0;

  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(folder, file), "utf8")) as Record<string, unknown>;
    const legacyLoanId = Number(payload.id);
    const accountNumber = `LEGACY-${legacyLoanId}`;
    const localLoan = allLoansByAccountNumber.get(accountNumber);
    if (!localLoan) continue;

    const currency = (payload.currency ?? {}) as Record<string, unknown>;
    const exponent = Number(currency.decimalPlaces ?? 2);
    const periods = ((payload.repaymentSchedule ?? {}) as Record<string, unknown>).periods as Array<Record<string, unknown>> | undefined;
    if (!periods) continue;

    let touchedThisLoan = false;
    for (const period of periods) {
      const installmentNumber = Number(period.period ?? 0);
      if (installmentNumber <= 0) continue;

      const principalWaivedMinor = toMinor(Number(period.principalWaived ?? 0), exponent);
      const interestWaivedMinor = toMinor(Number(period.interestWaived ?? 0), exponent);
      const feesWaivedMinor = toMinor(Number(period.feeChargesWaived ?? 0), exponent);
      const penaltiesWaivedMinor = toMinor(Number(period.penaltyChargesWaived ?? 0), exponent);
      if (principalWaivedMinor + interestWaivedMinor + feesWaivedMinor + penaltiesWaivedMinor === 0n) continue;

      const result = await prisma.loanInstallment.updateMany({
        where: {
          loanId: localLoan.id,
          installmentNumber,
          principalWaivedMinor: 0n,
          interestWaivedMinor: 0n,
          feesWaivedMinor: 0n,
          penaltiesWaivedMinor: 0n,
        },
        data: { principalWaivedMinor, interestWaivedMinor, feesWaivedMinor, penaltiesWaivedMinor },
      });
      if (result.count > 0) {
        installmentsUpdated += result.count;
        touchedThisLoan = true;
      }
    }
    if (touchedThisLoan) loansWithWaivedBackfilled += 1;
  }

  console.log(`Backfilled waived amounts on ${installmentsUpdated} installment row(s) across ${loansWithWaivedBackfilled} loan(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

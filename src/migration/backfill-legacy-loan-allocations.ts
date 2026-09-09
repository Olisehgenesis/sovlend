import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { transactionTypeVariants } from "@/lib/loan-transaction-type-variants";

import { reconcileLegacyLoanAllocations, type LegacyAllocationInstallment, type LegacyAllocationTransaction } from "./legacy-loan-allocation-reconciliation";
import { toMinor } from "./money";

const LEGACY_REF_PREFIX = "legacy:";
const LEGACY_ACCOUNT_PREFIX = "LEGACY-";
const REPAYMENT_TRANSACTION_TYPES = [
  ...transactionTypeVariants("REPAYMENT"),
  ...transactionTypeVariants("REPAYMENT_AT_DISBURSEMENT"),
  ...transactionTypeVariants("RECOVERY_REPAYMENT"),
] as const;

type RawLegacyTransaction = Readonly<{
  id: number;
  dateKey: string | null;
  typeCode: string;
  amountMinor: bigint;
  principalMinor: bigint;
  interestMinor: bigint;
  feesMinor: bigint;
  penaltiesMinor: bigint;
  manuallyReversed: boolean;
}>;

type ArchiveRoot = Readonly<{
  root: string;
  extractedAt: string;
}>;

export type BackfillLegacyLoanAllocationsOptions = Readonly<{
  apply?: boolean;
  archiveBaseDir?: string;
  logger?: Pick<Console, "log" | "warn" | "error">;
  loanAccountNumbers?: readonly string[];
  roundingToleranceMinor?: bigint;
}>;

export type BackfillLegacyLoanAllocationsResult = Readonly<{
  dryRun: boolean;
  archiveRoots: readonly string[];
  candidateLoans: number;
  reconciledLoans: number;
  skippedLoans: readonly string[];
  transactionsExamined: number;
  allocationsCreated: number;
  transactionsBackfilled: number;
  excludedRepaymentAtDisbursement: number;
  excludedReversedTransactions: number;
  loansWithRoundingAdjustments: number;
}>;

export async function backfillLegacyLoanAllocations(
  prisma: PrismaClient,
  options: BackfillLegacyLoanAllocationsOptions = {},
): Promise<BackfillLegacyLoanAllocationsResult> {
  const logger = options.logger ?? console;
  const dryRun = options.apply !== true;
  const roundingToleranceMinor = options.roundingToleranceMinor ?? 2n;
  const archiveRoots = await discoverArchiveRoots(options.archiveBaseDir ?? ".migration-data");
  if (archiveRoots.length === 0) throw new Error("No migration archives with raw/loans data were found");

  const loanIds = await prisma.loanTransaction.findMany({
    where: {
      externalReference: { startsWith: LEGACY_REF_PREFIX },
      transactionType: { in: [...REPAYMENT_TRANSACTION_TYPES] },
      allocations: { none: {} },
      ...(options.loanAccountNumbers?.length
        ? { loan: { accountNumber: { in: [...options.loanAccountNumbers] } } }
        : {}),
    },
    select: { loanId: true },
    distinct: ["loanId"],
  });

  let reconciledLoans = 0;
  let transactionsExamined = 0;
  let allocationsCreated = 0;
  let transactionsBackfilled = 0;
  let excludedRepaymentAtDisbursement = 0;
  let excludedReversedTransactions = 0;
  let loansWithRoundingAdjustments = 0;
  const skippedLoans: string[] = [];

  for (const [index, item] of loanIds.entries()) {
    const loan = await prisma.loan.findUnique({
      where: { id: item.loanId },
      select: {
        id: true,
        accountNumber: true,
        installments: {
          orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }],
          select: {
            id: true,
            dueOn: true,
            installmentNumber: true,
            principalPaidMinor: true,
            interestPaidMinor: true,
            feesPaidMinor: true,
            penaltiesPaidMinor: true,
            monitoringFeePaidMinor: true,
            transactionAllocations: {
              select: {
                principalMinor: true,
                interestMinor: true,
                feesMinor: true,
                penaltiesMinor: true,
                monitoringFeeMinor: true,
              },
            },
          },
        },
        transactions: {
          where: {
            externalReference: { startsWith: LEGACY_REF_PREFIX },
            transactionType: { in: [...REPAYMENT_TRANSACTION_TYPES] },
          },
          orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            businessDate: true,
            transactionType: true,
            externalReference: true,
            reversedById: true,
            allocations: { select: { id: true } },
          },
        },
      },
    });
    if (!loan) continue;

    if ((index + 1) % 50 === 0 || index + 1 === loanIds.length) {
      logger.log(`[backfill-legacy-loan-allocations] Loans processed ${index + 1}/${loanIds.length}`);
    }

    const remainingInstallments = buildRemainingInstallments(loan.installments);
    const negativeRemaining = remainingInstallments.find((installment) => hasNegativeRemaining(installment));
    if (negativeRemaining) {
      skippedLoans.push(`${loan.accountNumber}: existing allocations already exceed installment paid totals`);
      continue;
    }

    const candidateTransactions = loan.transactions.filter((transaction) => transaction.allocations.length === 0);
    if (candidateTransactions.length === 0) continue;
    transactionsExamined += candidateTransactions.length;

    const legacyLoanId = parseLegacyLoanId(loan.accountNumber);
    if (legacyLoanId == null) {
      skippedLoans.push(`${loan.accountNumber}: not a legacy loan account number`);
      continue;
    }

    const rawLookup = await loadRawLoanTransactions(archiveRoots, legacyLoanId);
    if (!rawLookup.ok) {
      skippedLoans.push(`${loan.accountNumber}: ${rawLookup.reason}`);
      continue;
    }

    const unrecoverableDisagreement = candidateTransactions.find((transaction) => {
      const legacyTxnId = parseLegacyTxnId(transaction.externalReference);
      return legacyTxnId != null && rawLookup.disagreements.has(legacyTxnId);
    });
    if (unrecoverableDisagreement) {
      skippedLoans.push(`${loan.accountNumber}: archive disagreement for transaction ${unrecoverableDisagreement.externalReference}`);
      continue;
    }

    const active: Array<LegacyAllocationTransaction & { rawTypeCode: string }> = [];
    let fatalLoanError: string | null = null;
    for (const transaction of candidateTransactions) {
      if (!transaction.externalReference) {
        fatalLoanError = `transaction ${transaction.id} is missing its legacy external reference`;
        break;
      }
      if (transaction.reversedById) {
        excludedReversedTransactions += 1;
        continue;
      }

      const legacyTxnId = parseLegacyTxnId(transaction.externalReference);
      const raw = legacyTxnId == null ? null : rawLookup.transactions.get(legacyTxnId);
      if (!raw) {
        fatalLoanError = `raw transaction not found for ${transaction.externalReference}`;
        break;
      }
      if (raw.manuallyReversed) {
        excludedReversedTransactions += 1;
        continue;
      }
      if (raw.principalMinor + raw.interestMinor + raw.feesMinor + raw.penaltiesMinor <= 0n) continue;

      active.push({
        id: transaction.id,
        businessDate: transaction.businessDate,
        sortKey: legacyTxnId ?? undefined,
        principalMinor: raw.principalMinor,
        interestMinor: raw.interestMinor,
        feesMinor: raw.feesMinor,
        penaltiesMinor: raw.penaltiesMinor,
        monitoringFeeMinor: 0n,
        rawTypeCode: raw.typeCode,
      });
    }
    if (fatalLoanError) {
      skippedLoans.push(`${loan.accountNumber}: ${fatalLoanError}`);
      continue;
    }
    if (active.length === 0) {
      if (sumInstallmentCapacityTotal(remainingInstallments) === 0n) reconciledLoans += 1;
      continue;
    }

    const { includedTransactions, excludedCount } = excludeNonInstallmentRepaymentsAtDisbursement(active, remainingInstallments, roundingToleranceMinor);
    excludedRepaymentAtDisbursement += excludedCount;
    if (includedTransactions.length === 0) {
      if (sumInstallmentCapacityTotal(remainingInstallments) === 0n) reconciledLoans += 1;
      else skippedLoans.push(`${loan.accountNumber}: no installment-backed repayment transactions remained after exclusions`);
      continue;
    }

    const reconciliation = reconcileLegacyLoanAllocations(remainingInstallments, includedTransactions, { roundingToleranceMinor });
    if (!reconciliation.ok) {
      skippedLoans.push(`${loan.accountNumber}: ${reconciliation.reason}`);
      continue;
    }

    if (reconciliation.adjustedForRounding) {
      loansWithRoundingAdjustments += 1;
      logger.warn(`[backfill-legacy-loan-allocations] ${loan.accountNumber}: ${reconciliation.adjustments.join("; ")}`);
    }

    if (!dryRun && reconciliation.allocations.length > 0) {
      await prisma.$transaction(async (transaction) => {
        await transaction.loanTransactionAllocation.createMany({
          data: reconciliation.allocations.map((allocation) => ({
            transactionId: allocation.transactionId,
            installmentId: allocation.installmentId,
            principalMinor: allocation.principalMinor,
            interestMinor: allocation.interestMinor,
            feesMinor: allocation.feesMinor,
            penaltiesMinor: allocation.penaltiesMinor,
            monitoringFeeMinor: allocation.monitoringFeeMinor,
          })),
          skipDuplicates: true,
        });
      });
    }

    reconciledLoans += 1;
    allocationsCreated += reconciliation.allocations.length;
    transactionsBackfilled += new Set(reconciliation.allocations.map((allocation) => allocation.transactionId)).size;
  }

  logger.log(`${dryRun ? "Dry-run" : "Apply"} complete for legacy loan allocation backfill.`);
  logger.log(`Archive roots: ${archiveRoots.map((archive) => archive.root).join(", ")}`);
  logger.log(`Candidate loans: ${loanIds.length}`);
  logger.log(`Reconciled loans: ${reconciledLoans}`);
  logger.log(`Skipped loans: ${skippedLoans.length}`);
  logger.log(`Transactions examined: ${transactionsExamined}`);
  logger.log(`Transactions backfilled: ${transactionsBackfilled}`);
  logger.log(`Allocation rows ${dryRun ? "to create" : "created"}: ${allocationsCreated}`);
  logger.log(`Excluded repayment-at-disbursement transactions: ${excludedRepaymentAtDisbursement}`);
  logger.log(`Excluded reversed transactions: ${excludedReversedTransactions}`);

  return {
    dryRun,
    archiveRoots: archiveRoots.map((archive) => archive.root),
    candidateLoans: loanIds.length,
    reconciledLoans,
    skippedLoans,
    transactionsExamined,
    allocationsCreated,
    transactionsBackfilled,
    excludedRepaymentAtDisbursement,
    excludedReversedTransactions,
    loansWithRoundingAdjustments,
  };
}

function buildRemainingInstallments(
  installments: Array<{
    id: string;
    dueOn: Date;
    installmentNumber: number;
    principalPaidMinor: bigint;
    interestPaidMinor: bigint;
    feesPaidMinor: bigint;
    penaltiesPaidMinor: bigint;
    monitoringFeePaidMinor: bigint;
    transactionAllocations: Array<{
      principalMinor: bigint;
      interestMinor: bigint;
      feesMinor: bigint;
      penaltiesMinor: bigint;
      monitoringFeeMinor: bigint;
    }>;
  }>,
): LegacyAllocationInstallment[] {
  return installments.map((installment) => {
    const existing = installment.transactionAllocations.reduce(
      (totals, allocation) => ({
        principalMinor: totals.principalMinor + allocation.principalMinor,
        interestMinor: totals.interestMinor + allocation.interestMinor,
        feesMinor: totals.feesMinor + allocation.feesMinor,
        penaltiesMinor: totals.penaltiesMinor + allocation.penaltiesMinor,
        monitoringFeeMinor: totals.monitoringFeeMinor + allocation.monitoringFeeMinor,
      }),
      { principalMinor: 0n, interestMinor: 0n, feesMinor: 0n, penaltiesMinor: 0n, monitoringFeeMinor: 0n },
    );
    return {
      id: installment.id,
      dueOn: installment.dueOn,
      installmentNumber: installment.installmentNumber,
      principalPaidRemainingMinor: installment.principalPaidMinor - existing.principalMinor,
      interestPaidRemainingMinor: installment.interestPaidMinor - existing.interestMinor,
      feesPaidRemainingMinor: installment.feesPaidMinor - existing.feesMinor,
      penaltiesPaidRemainingMinor: installment.penaltiesPaidMinor - existing.penaltiesMinor,
      monitoringFeePaidRemainingMinor: installment.monitoringFeePaidMinor - existing.monitoringFeeMinor,
    };
  });
}

function excludeNonInstallmentRepaymentsAtDisbursement(
  transactions: Array<LegacyAllocationTransaction & { rawTypeCode: string }>,
  installments: readonly LegacyAllocationInstallment[],
  roundingToleranceMinor: bigint,
) {
  const active = [...transactions];
  let excludedCount = 0;
  for (;;) {
    const capacity = sumInstallmentCapacities(installments);
    const totals = sumTransactionTotals(active);
    const overages = {
      principalMinor: totals.principalMinor - capacity.principalMinor,
      interestMinor: totals.interestMinor - capacity.interestMinor,
      feesMinor: totals.feesMinor - capacity.feesMinor,
      penaltiesMinor: totals.penaltiesMinor - capacity.penaltiesMinor,
      monitoringFeeMinor: totals.monitoringFeeMinor - capacity.monitoringFeeMinor,
    };
    if (!hasMeaningfulOverage(overages, roundingToleranceMinor)) break;
    const index = active.findIndex(
      (transaction) =>
        transaction.rawTypeCode === "loanTransactionType.repaymentAtDisbursement" &&
        removableAgainstOverage(transaction, overages, roundingToleranceMinor),
    );
    if (index < 0) break;
    active.splice(index, 1);
    excludedCount += 1;
  }
  return { includedTransactions: active, excludedCount };
}

function removableAgainstOverage(
  transaction: LegacyAllocationTransaction,
  overages: Record<keyof Omit<LegacyAllocationTransaction, "id" | "businessDate" | "sortKey">, bigint>,
  roundingToleranceMinor: bigint,
) {
  return (
    withinOverage(transaction.principalMinor, overages.principalMinor, roundingToleranceMinor) &&
    withinOverage(transaction.interestMinor, overages.interestMinor, roundingToleranceMinor) &&
    withinOverage(transaction.feesMinor, overages.feesMinor, roundingToleranceMinor) &&
    withinOverage(transaction.penaltiesMinor, overages.penaltiesMinor, roundingToleranceMinor) &&
    withinOverage(transaction.monitoringFeeMinor, overages.monitoringFeeMinor, roundingToleranceMinor)
  );
}

function withinOverage(amount: bigint, overage: bigint, tolerance: bigint) {
  if (amount === 0n) return true;
  if (overage <= 0n) return false;
  return amount <= overage + tolerance;
}

function hasMeaningfulOverage(
  overages: Record<keyof Omit<LegacyAllocationTransaction, "id" | "businessDate" | "sortKey">, bigint>,
  tolerance: bigint,
) {
  return Object.values(overages).some((value) => value > tolerance);
}

function sumInstallmentCapacities(installments: readonly LegacyAllocationInstallment[]) {
  return installments.reduce(
    (totals, installment) => ({
      principalMinor: totals.principalMinor + installment.principalPaidRemainingMinor,
      interestMinor: totals.interestMinor + installment.interestPaidRemainingMinor,
      feesMinor: totals.feesMinor + installment.feesPaidRemainingMinor,
      penaltiesMinor: totals.penaltiesMinor + installment.penaltiesPaidRemainingMinor,
      monitoringFeeMinor: totals.monitoringFeeMinor + installment.monitoringFeePaidRemainingMinor,
    }),
    { principalMinor: 0n, interestMinor: 0n, feesMinor: 0n, penaltiesMinor: 0n, monitoringFeeMinor: 0n },
  );
}

function sumInstallmentCapacityTotal(installments: readonly LegacyAllocationInstallment[]) {
  return installments.reduce(
    (sum, installment) =>
      sum +
      installment.principalPaidRemainingMinor +
      installment.interestPaidRemainingMinor +
      installment.feesPaidRemainingMinor +
      installment.penaltiesPaidRemainingMinor +
      installment.monitoringFeePaidRemainingMinor,
    0n,
  );
}

function sumTransactionTotals(transactions: readonly LegacyAllocationTransaction[]) {
  return transactions.reduce(
    (totals, transaction) => ({
      principalMinor: totals.principalMinor + transaction.principalMinor,
      interestMinor: totals.interestMinor + transaction.interestMinor,
      feesMinor: totals.feesMinor + transaction.feesMinor,
      penaltiesMinor: totals.penaltiesMinor + transaction.penaltiesMinor,
      monitoringFeeMinor: totals.monitoringFeeMinor + transaction.monitoringFeeMinor,
    }),
    { principalMinor: 0n, interestMinor: 0n, feesMinor: 0n, penaltiesMinor: 0n, monitoringFeeMinor: 0n },
  );
}

function hasNegativeRemaining(installment: LegacyAllocationInstallment) {
  return (
    installment.principalPaidRemainingMinor < 0n ||
    installment.interestPaidRemainingMinor < 0n ||
    installment.feesPaidRemainingMinor < 0n ||
    installment.penaltiesPaidRemainingMinor < 0n ||
    installment.monitoringFeePaidRemainingMinor < 0n
  );
}

async function discoverArchiveRoots(baseDir: string): Promise<ArchiveRoot[]> {
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return [];
  }
  const roots: ArchiveRoot[] = [];
  for (const entry of entries.sort()) {
    const root = path.join(baseDir, entry);
    try {
      const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as { extractedAt?: string };
      await access(path.join(root, "raw", "loans"));
      roots.push({ root, extractedAt: manifest.extractedAt ?? "" });
    } catch {
      continue;
    }
  }
  return roots.sort((left, right) => right.extractedAt.localeCompare(left.extractedAt));
}

async function loadRawLoanTransactions(archiveRoots: readonly ArchiveRoot[], legacyLoanId: number) {
  const matches = new Map<number, RawLegacyTransaction>();
  const disagreements = new Set<number>();
  let foundAnyFile = false;

  for (const archive of archiveRoots) {
    const payload = await readRawLoanFile(archive.root, legacyLoanId);
    if (!payload) continue;
    foundAnyFile = true;
    const transactions = (payload.transactions as Array<Record<string, unknown>> | undefined) ?? [];
    const currency = payload.currency as Record<string, unknown> | undefined;
    const exponent = Number(currency?.decimalPlaces ?? 2);
    for (const transaction of transactions) {
      const normalized = normalizeRawLegacyTransaction(transaction, exponent);
      if (!normalized) continue;
      const existing = matches.get(normalized.id);
      if (!existing) {
        matches.set(normalized.id, normalized);
        continue;
      }
      if (!sameRawTransaction(existing, normalized)) disagreements.add(normalized.id);
    }
  }

  if (!foundAnyFile) return { ok: false as const, reason: `no raw archive file found for legacy loan ${legacyLoanId}` };
  return { ok: true as const, transactions: matches, disagreements };
}

async function readRawLoanFile(root: string, legacyLoanId: number) {
  for (const fileName of [`${legacyLoanId}.json`, `${String(legacyLoanId).padStart(6, "0")}.json`]) {
    const file = path.join(root, "raw", "loans", fileName);
    try {
      return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeRawLegacyTransaction(transaction: Record<string, unknown>, exponent: number): RawLegacyTransaction | null {
  const id = Number(transaction.id);
  if (!Number.isInteger(id)) return null;
  return {
    id,
    dateKey: Array.isArray(transaction.date) ? transaction.date.join("-") : null,
    typeCode: String((transaction.type as Record<string, unknown> | undefined)?.code ?? ""),
    amountMinor: toMinor(Number(transaction.amount ?? 0), exponent),
    principalMinor: toMinor(Number(transaction.principalPortion ?? 0), exponent),
    interestMinor: toMinor(Number(transaction.interestPortion ?? 0), exponent),
    feesMinor: toMinor(Number(transaction.feeChargesPortion ?? 0), exponent),
    penaltiesMinor: toMinor(Number(transaction.penaltyChargesPortion ?? 0), exponent),
    manuallyReversed: Boolean(transaction.manuallyReversed),
  };
}

function sameRawTransaction(left: RawLegacyTransaction, right: RawLegacyTransaction) {
  return (
    left.dateKey === right.dateKey &&
    left.typeCode === right.typeCode &&
    left.amountMinor === right.amountMinor &&
    left.principalMinor === right.principalMinor &&
    left.interestMinor === right.interestMinor &&
    left.feesMinor === right.feesMinor &&
    left.penaltiesMinor === right.penaltiesMinor &&
    left.manuallyReversed === right.manuallyReversed
  );
}

function parseLegacyLoanId(accountNumber: string) {
  if (!accountNumber.startsWith(LEGACY_ACCOUNT_PREFIX)) return null;
  const value = Number(accountNumber.slice(LEGACY_ACCOUNT_PREFIX.length));
  return Number.isInteger(value) ? value : null;
}

function parseLegacyTxnId(externalReference: string | null) {
  if (!externalReference?.startsWith(LEGACY_REF_PREFIX)) return null;
  const parts = externalReference.split(":");
  if (parts.length < 3) return null;
  const value = Number(parts[2]);
  return Number.isInteger(value) ? value : null;
}

function parseOptions(argv: readonly string[]): BackfillLegacyLoanAllocationsOptions {
  const options: BackfillLegacyLoanAllocationsOptions = { apply: false };
  const loanAccountNumbers: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      (options as { apply: boolean }).apply = true;
      continue;
    }
    if (argument === "--archive-base-dir") {
      (options as { archiveBaseDir?: string }).archiveBaseDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--loan") {
      const value = argv[index + 1];
      if (value) loanAccountNumbers.push(value);
      index += 1;
    }
  }
  if (loanAccountNumbers.length > 0) (options as { loanAccountNumbers?: readonly string[] }).loanAccountNumbers = loanAccountNumbers;
  return options;
}

async function main() {
  const result = await backfillLegacyLoanAllocations(prisma, parseOptions(process.argv.slice(2)));
  if (result.skippedLoans.length > 0) console.log(`Skipped loans:\n${result.skippedLoans.join("\n")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main()
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

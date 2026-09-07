import Decimal from "decimal.js";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { ReadOnlyFineractClient } from "./fineract-client";

type LegacySavingsTransaction = Record<string, unknown>;

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getStaggerMs(environment: NodeJS.ProcessEnv) {
  const parsed = Number.parseInt(environment.MIGRATION_STAGGER_MS ?? "150", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 150;
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toMinor(amount: number, exponent = 2): bigint {
  return BigInt(new Decimal(amount).mul(new Decimal(10).pow(exponent)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value as number[];
  return new Date(Date.UTC(year, month - 1, day));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function legacySavingsAccountIdFromAccountNumber(accountNumber: string): number | null {
  if (!/^\d+$/.test(accountNumber)) return null;
  const legacySavingsAccountId = Number.parseInt(accountNumber, 10);
  if (!Number.isInteger(legacySavingsAccountId) || legacySavingsAccountId <= 0) return null;
  return String(legacySavingsAccountId).padStart(accountNumber.length, "0") === accountNumber ? legacySavingsAccountId : null;
}

function signedAmountMinor(transaction: LegacySavingsTransaction, exponent: number): bigint {
  if (transaction.reversed === true) return 0n;

  const amountMinor = toMinor(asNumber(transaction.amount) ?? 0, exponent);
  const transactionType = asRecord(transaction.transactionType);

  if (transactionType?.deposit === true || transactionType?.dividendPayout === true || transactionType?.interestPosting === true || transactionType?.approveTransfer === true || transactionType?.amountRelease === true || transactionType?.rejectTransfer === true) {
    return amountMinor;
  }

  if (transactionType?.withdrawal === true || transactionType?.feeDeduction === true || transactionType?.initiateTransfer === true || transactionType?.withdrawTransfer === true || transactionType?.overdraftInterest === true || transactionType?.overdraftFee === true || transactionType?.withholdTax === true || transactionType?.escheat === true || transactionType?.amountHold === true || transactionType?.writtenoff === true) {
    return -amountMinor;
  }

  return amountMinor;
}

function asTransactions(value: unknown): LegacySavingsTransaction[] {
  return Array.isArray(value) ? value.map(asRecord).filter((entry): entry is LegacySavingsTransaction => entry !== null) : [];
}

export async function importSavingsTransactions(
  prisma: PrismaClient,
  fineract: ReadOnlyFineractClient,
): Promise<{ accountsProcessed: number; transactionsImported: number; transactionsSkipped: string[] }> {
  const staggerMs = getStaggerMs(process.env);
  const accounts = await prisma.savingsAccount.findMany({
    select: { id: true, accountNumber: true },
    orderBy: { createdAt: "asc" },
  });

  let transactionsImported = 0;
  const transactionsSkipped: string[] = [];

  for (const account of accounts) {
    const legacySavingsAccountId = legacySavingsAccountIdFromAccountNumber(account.accountNumber);
    if (legacySavingsAccountId === null) {
      transactionsSkipped.push(`${account.accountNumber}: invalid legacy savings account id`);
      continue;
    }

    let payload: unknown;
    try {
      payload = await fineract.getSavingsAccount(legacySavingsAccountId);
    } catch (error) {
      transactionsSkipped.push(`${account.accountNumber}: failed to fetch savings account (${errorMessage(error)})`);
      await sleep(staggerMs);
      continue;
    }
    await sleep(staggerMs);

    const savingsAccount = asRecord(payload);
    const currency = asRecord(savingsAccount?.currency);
    const exponent = asNumber(currency?.decimalPlaces) ?? 2;
    const transactions = asTransactions(savingsAccount?.transactions);

    for (const transaction of transactions) {
      const legacyTransactionId = asNumber(transaction.id);
      if (legacyTransactionId === null) {
        transactionsSkipped.push(`${account.accountNumber}: encountered transaction without numeric id`);
        continue;
      }

      const idempotencyKey = `savings-tx-${legacySavingsAccountId}-${legacyTransactionId}`;
      const existing = await prisma.savingsTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (existing) continue;

      try {
        await prisma.savingsTransaction.create({
          data: {
            savingsAccountId: account.id,
            transactionType: asString(asRecord(transaction.transactionType)?.value) ?? "Unknown",
            amountMinor: signedAmountMinor(transaction, exponent),
            externalReference: String(legacyTransactionId),
            idempotencyKey,
            createdAt: dateFromParts(transaction.date) ?? new Date(),
          },
        });
        transactionsImported += 1;
      } catch (error) {
        transactionsSkipped.push(`${account.accountNumber} transaction ${legacyTransactionId}: ${errorMessage(error)}`);
      }
    }
  }

  return { accountsProcessed: accounts.length, transactionsImported, transactionsSkipped };
}

async function main() {
  process.loadEnvFile?.();

  const baseUrl = required(process.env, "LEGACY_BASE_URL");
  const tenantId = required(process.env, "LEGACY_TENANT_ID");
  const username = required(process.env, "LEGACY_USERNAME");
  const password = required(process.env, "LEGACY_PASSWORD");
  const fineract = new ReadOnlyFineractClient(baseUrl, tenantId, username, password);

  try {
    const result = await importSavingsTransactions(prisma, fineract);
    console.log("Savings transaction import complete.");
    console.log(`Accounts processed: ${result.accountsProcessed}`);
    console.log(`Transactions imported: ${result.transactionsImported}`);
    console.log(`Transactions skipped: ${result.transactionsSkipped.length}`);
    if (result.transactionsSkipped.length > 0) console.log(`Skip reasons:\n${result.transactionsSkipped.join("\n")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { ReadOnlyFineractClient } from "./fineract-client";
import { legacySavingsAccountIdFromAccountNumber, planLegacySavingsTransactionImports } from "./legacy-savings";

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

    const existingIdempotencyKeys = new Set(
      (await prisma.savingsTransaction.findMany({
        where: { savingsAccountId: account.id },
        select: { idempotencyKey: true },
      })).map((transaction) => transaction.idempotencyKey),
    );
    const plan = planLegacySavingsTransactionImports(account.accountNumber, payload, existingIdempotencyKeys);
    transactionsSkipped.push(...plan.skipped);

    for (const transaction of plan.transactionsToCreate) {
      try {
        await prisma.savingsTransaction.create({
          data: {
            savingsAccountId: account.id,
            transactionType: transaction.transactionType,
            amountMinor: transaction.amountMinor,
            externalReference: transaction.externalReference,
            idempotencyKey: transaction.idempotencyKey,
            createdAt: transaction.createdAt,
          },
        });
        transactionsImported += 1;
      } catch (error) {
        transactionsSkipped.push(`${account.accountNumber} transaction ${transaction.legacyTransactionId}: ${errorMessage(error)}`);
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

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { asRecord, asString, planLegacySavingsTransactionImports } from "./legacy-savings";

export type ImportArchiveSavingsResult = Readonly<{
  accountsProcessed: number;
  accountsSynced: number;
  transactionsImported: number;
  accountsSkipped: string[];
}>;

export async function syncExistingSavingsAccountsFromArchive(prisma: PrismaClient, root: string): Promise<ImportArchiveSavingsResult> {
  const folder = path.join(root, "raw", "savings-accounts");
  let files: string[];

  try {
    files = (await readdir(folder)).filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return { accountsProcessed: 0, accountsSynced: 0, transactionsImported: 0, accountsSkipped: [] };
  }

  const localAccounts = await prisma.savingsAccount.findMany({
    select: { id: true, accountNumber: true },
  });
  const localAccountsByNumber = new Map(localAccounts.map((account) => [account.accountNumber, account]));

  let accountsProcessed = 0;
  let accountsSynced = 0;
  let transactionsImported = 0;
  const accountsSkipped: string[] = [];

  for (const file of files) {
    accountsProcessed += 1;
    const payload = JSON.parse(await readFile(path.join(folder, file), "utf8")) as unknown;
    const accountNumber = asString(asRecord(payload)?.accountNo);
    if (!accountNumber) {
      accountsSkipped.push(`Savings archive ${file}: missing accountNo`);
      continue;
    }

    const localAccount = localAccountsByNumber.get(accountNumber);
    if (!localAccount) continue;

    try {
      const existingIdempotencyKeys = new Set(
        (await prisma.savingsTransaction.findMany({
          where: { savingsAccountId: localAccount.id },
          select: { idempotencyKey: true },
        })).map((transaction) => transaction.idempotencyKey),
      );
      const plan = planLegacySavingsTransactionImports(accountNumber, payload, existingIdempotencyKeys);
      accountsSkipped.push(...plan.skipped);

      if (plan.transactionsToCreate.length > 0) {
        const created = await prisma.savingsTransaction.createMany({
          data: plan.transactionsToCreate.map((transaction) => ({
            savingsAccountId: localAccount.id,
            transactionType: transaction.transactionType,
            amountMinor: transaction.amountMinor,
            externalReference: transaction.externalReference,
            idempotencyKey: transaction.idempotencyKey,
            createdAt: transaction.createdAt,
          })),
          skipDuplicates: true,
        });
        transactionsImported += created.count;
      }

      accountsSynced += 1;
    } catch (error) {
      accountsSkipped.push(`Savings ${accountNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { accountsProcessed, accountsSynced, transactionsImported, accountsSkipped };
}

async function main() {
  process.loadEnvFile?.(".env");

  const root = path.resolve(
    process.argv[2] ?? path.resolve(process.env.MIGRATION_ARCHIVE_DIR ?? ".migration-data", process.env.MIGRATION_ARCHIVE_RUN_ID ?? "ilend-full-archive-20260903"),
  );
  const result = await syncExistingSavingsAccountsFromArchive(prisma, root);
  console.log("Savings archive sync complete.");
  console.log(`Accounts processed: ${result.accountsProcessed}`);
  console.log(`Accounts synced: ${result.accountsSynced}`);
  console.log(`Transactions imported: ${result.transactionsImported}`);
  console.log(`Accounts skipped: ${result.accountsSkipped.length}`);
  if (result.accountsSkipped.length > 0) console.log(`Skip reasons:\n${result.accountsSkipped.join("\n")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

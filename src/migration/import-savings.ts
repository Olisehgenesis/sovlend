import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Decimal from "decimal.js";
import { PrismaClient, type Prisma } from "@prisma/client";

import { deterministicUuid } from "./import-foundation";

export type ImportSavingsResult = {
  productsImported: number;
  clientAccountsImported: number;
  groupAccountsImported: number;
  accountsSkipped: string[];
};

type LegacySavingsProduct = Record<string, unknown>;
type LegacySavingsAccount = Record<string, unknown>;
type OwnerKind = "client" | "group";

type AccountImportContext = Readonly<{
  prisma: PrismaClient;
  organizationId: string;
  ownerKind: OwnerKind;
  ownerId: string;
  legacyOwnerId: number;
  fileName: string;
  accounts: LegacySavingsAccount[];
  accountsSkipped: string[];
}>;

export async function importSavingsProductsAndAccounts(prisma: PrismaClient, root: string, organizationId: string): Promise<ImportSavingsResult> {
  const productsImported = await importSavingsProducts(prisma, root, organizationId);
  const accountsSkipped: string[] = [];
  const clientAccountsImported = await importClientSavingsAccounts(prisma, root, organizationId, accountsSkipped);
  const groupAccountsImported = await importGroupSavingsAccounts(prisma, root, organizationId, accountsSkipped);
  return { productsImported, clientAccountsImported, groupAccountsImported, accountsSkipped };
}

async function importSavingsProducts(prisma: PrismaClient, root: string, organizationId: string): Promise<number> {
  const file = path.join(root, "raw", "savingsproducts", "000000.json");
  const products = JSON.parse(await readFile(file, "utf8")) as LegacySavingsProduct[];

  let imported = 0;
  for (const product of products) {
    const legacyProductId = asNumber(product.id);
    const name = asString(product.name);
    const shortName = asString(product.shortName);
    const currency = recordOrNull(product.currency);
    const currencyCode = asString(currency?.code);
    const exponent = asNumber(currency?.decimalPlaces) ?? 2;

    if (legacyProductId === null || !name || !shortName || !currencyCode) {
      throw new Error(`Invalid savings product payload in ${file}`);
    }

    const id = deterministicUuid(`savingsproduct:${organizationId}:${legacyProductId}`);
    const values = {
      organizationId,
      name,
      shortName,
      description: asString(product.description),
      currencyCode,
      nominalAnnualRateBps: Math.round((asNumber(product.nominalAnnualInterestRate) ?? 0) * 100),
      minOpeningBalanceMinor: toMinor(asNumber(product.minRequiredOpeningBalance) ?? 0, exponent),
      active: true,
    };

    await prisma.savingsProduct.upsert({ where: { id }, create: { id, ...values }, update: values });
    imported += 1;
  }

  return imported;
}

async function importClientSavingsAccounts(prisma: PrismaClient, root: string, organizationId: string, accountsSkipped: string[]): Promise<number> {
  const folder = path.join(root, "raw", "client-accounts");
  const files = await listJsonFiles(folder);
  let imported = 0;

  for (const fileName of files) {
    const payload = JSON.parse(await readFile(path.join(folder, fileName), "utf8")) as Record<string, unknown>;
    if (isEmptyPayload(payload)) continue;

    const legacyClientId = legacyIdFromFileName(fileName);
    if (legacyClientId === null) {
      accountsSkipped.push(`Client accounts file ${fileName}: could not determine legacy client id`);
      continue;
    }

    const clientId = deterministicUuid(`client:${organizationId}:${legacyClientId}`);
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) {
      accountsSkipped.push(`Client #${legacyClientId}: client row ${clientId} not found for ${fileName}`);
      continue;
    }

    imported += await importSavingsAccountsForOwner({
      prisma,
      organizationId,
      ownerKind: "client",
      ownerId: clientId,
      legacyOwnerId: legacyClientId,
      fileName,
      accounts: asSavingsAccounts(payload.savingsAccounts),
      accountsSkipped,
    });
  }

  return imported;
}

async function importGroupSavingsAccounts(prisma: PrismaClient, root: string, organizationId: string, accountsSkipped: string[]): Promise<number> {
  const folder = path.join(root, "raw", "group-accounts");
  const files = await listJsonFiles(folder);
  let imported = 0;

  for (const fileName of files) {
    const payload = JSON.parse(await readFile(path.join(folder, fileName), "utf8")) as Record<string, unknown>;
    if (isEmptyPayload(payload)) continue;

    const legacyGroupId = legacyIdFromFileName(fileName);
    if (legacyGroupId === null) {
      accountsSkipped.push(`Group accounts file ${fileName}: could not determine legacy group id`);
      continue;
    }

    const groupId = deterministicUuid(`group:${organizationId}:${legacyGroupId}`);
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!group) {
      accountsSkipped.push(`Group #${legacyGroupId}: group row ${groupId} not found for ${fileName}`);
      continue;
    }

    imported += await importSavingsAccountsForOwner({
      prisma,
      organizationId,
      ownerKind: "group",
      ownerId: groupId,
      legacyOwnerId: legacyGroupId,
      fileName,
      accounts: asSavingsAccounts(payload.savingsAccounts),
      accountsSkipped,
    });
  }

  return imported;
}

async function importSavingsAccountsForOwner(context: AccountImportContext): Promise<number> {
  let imported = 0;

  for (const entry of context.accounts) {
    const accountNumber = asString(entry.accountNo);
    const accountLabel = accountNumber ?? `legacy-entry-${asNumber(entry.id) ?? "unknown"}`;

    try {
      if (!accountNumber) {
        context.accountsSkipped.push(`${ownerPrefix(context.ownerKind, context.legacyOwnerId)} ${context.fileName}: missing accountNo for ${accountLabel}`);
        continue;
      }

      const existing = await context.prisma.savingsAccount.findUnique({ where: { accountNumber }, select: { id: true } });
      if (existing) continue;

      const legacyProductId = asNumber(entry.productId);
      if (legacyProductId === null) {
        context.accountsSkipped.push(`${ownerPrefix(context.ownerKind, context.legacyOwnerId)} savings ${accountNumber}: missing productId`);
        continue;
      }

      const productId = deterministicUuid(`savingsproduct:${context.organizationId}:${legacyProductId}`);
      const product = await context.prisma.savingsProduct.findUnique({ where: { id: productId }, select: { id: true } });
      if (!product) {
        context.accountsSkipped.push(`${ownerPrefix(context.ownerKind, context.legacyOwnerId)} savings ${accountNumber}: product #${legacyProductId} not imported`);
        continue;
      }

      const currency = recordOrNull(entry.currency);
      const currencyCode = asString(currency?.code);
      if (!currencyCode) {
        context.accountsSkipped.push(`${ownerPrefix(context.ownerKind, context.legacyOwnerId)} savings ${accountNumber}: missing currency code`);
        continue;
      }

      const timeline = recordOrNull(entry.timeline);
      const accountType = asString(recordOrNull(entry.accountType)?.value) ?? "Individual";

      await context.prisma.savingsAccount.create({
        data: {
          clientId: context.ownerKind === "client" ? context.ownerId : null,
          groupId: context.ownerKind === "group" ? context.ownerId : null,
          productId,
          accountNumber,
          accountType,
          externalId: asString(entry.externalId),
          currencyCode,
          status: mapSavingsStatus(entry.status),
          submittedOn: dateFromParts(timeline?.submittedOnDate),
          approvedOn: dateFromParts(timeline?.approvedOnDate),
          termsSnapshot: entry as Prisma.InputJsonValue,
        },
      });

      imported += 1;
    } catch (error) {
      context.accountsSkipped.push(`${ownerPrefix(context.ownerKind, context.legacyOwnerId)} savings ${accountLabel}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return imported;
}

function toMinor(amount: number, exponent = 2): bigint {
  return BigInt(new Decimal(amount).mul(new Decimal(10).pow(exponent)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value as number[];
  return new Date(Date.UTC(year, month - 1, day));
}

function mapSavingsStatus(value: unknown): string {
  const status = recordOrNull(value);
  const code = asString(status?.code);

  if (status?.active === true || code === "savingsAccountStatusType.active") return "ACTIVE";
  if (status?.closed === true || status?.prematureClosed === true || code === "savingsAccountStatusType.closed") return "CLOSED";
  if (status?.submittedAndPendingApproval === true || code === "savingsAccountStatusType.submitted.and.pending.approval") return "SUBMITTED";
  if (status?.approved === true || code === "savingsAccountStatusType.approved") return "APPROVED";
  if (status?.rejected === true) return "REJECTED";
  if (status?.withdrawnByApplicant === true) return "WITHDRAWN";
  if (status?.transferInProgress === true || status?.transferOnHold === true) return "ACTIVE";
  return "SUBMITTED";
}

function legacyIdFromFileName(fileName: string): number | null {
  const stem = path.basename(fileName, path.extname(fileName));
  const legacyId = Number.parseInt(stem, 10);
  return Number.isFinite(legacyId) ? legacyId : null;
}

async function listJsonFiles(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((entry) => entry.endsWith(".json")).sort();
}

function asSavingsAccounts(value: unknown): LegacySavingsAccount[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isEmptyPayload(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

function ownerPrefix(ownerKind: OwnerKind, legacyOwnerId: number): string {
  return `${ownerKind === "client" ? "Client" : "Group"} #${legacyOwnerId}`;
}

async function main() {
  process.loadEnvFile?.();

  const prisma = new PrismaClient();
  try {
    const organization = await prisma.organization.findFirstOrThrow({ select: { id: true, name: true } });
    const root = path.resolve(
      process.env.MIGRATION_ARCHIVE_DIR ?? ".migration-data",
      process.env.MIGRATION_ARCHIVE_RUN_ID ?? "ilend-full-archive-20260903",
    );
    const result = await importSavingsProductsAndAccounts(prisma, root, organization.id);

    console.log(`Savings import complete for ${organization.name}.`);
    console.log(`Archive root: ${root}`);
    console.log(`Products imported: ${result.productsImported}`);
    console.log(`Client accounts imported: ${result.clientAccountsImported}`);
    console.log(`Group accounts imported: ${result.groupAccountsImported}`);
    if (result.accountsSkipped.length === 0) {
      console.log("Skipped records: none");
    } else {
      console.log("Skipped records:");
      for (const message of result.accountsSkipped) console.log(`- ${message}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

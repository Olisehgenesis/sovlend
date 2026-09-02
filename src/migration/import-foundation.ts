import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import Decimal from "decimal.js";

import { verifyArchive } from "./archive";
import { seedPermissionGroups } from "@/modules/identity/application/seed-permissions";

const officeSchema = z.object({ id: z.number(), name: z.string(), externalId: z.string().nullable().optional(), hierarchy: z.string() });
const currencySchema = z.object({ code: z.string(), name: z.string(), decimalPlaces: z.number().int().min(0).max(18) });
const dateArraySchema = z.tuple([z.number(), z.number(), z.number()]);
const clientSchema = z.object({
  id: z.number(),
  accountNo: z.string(),
  externalId: z.string().nullable().optional(),
  displayName: z.string(),
  firstname: z.string().nullable().optional(),
  middlename: z.string().nullable().optional(),
  lastname: z.string().nullable().optional(),
  officeId: z.number(),
  mobileNo: z.string().nullable().optional(),
  dateOfBirth: dateArraySchema.nullable().optional(),
  activationDate: dateArraySchema.nullable().optional(),
  gender: z.object({ name: z.string().optional() }).passthrough().nullable().optional(),
  clientType: z.object({ name: z.string().optional() }).passthrough().nullable().optional(),
  clientClassification: z.object({ name: z.string().optional() }).passthrough().nullable().optional(),
  isStaff: z.boolean().optional(),
  status: z.object({ code: z.string() }),
  timeline: z.object({ submittedOnDate: dateArraySchema.nullable().optional() }).passthrough().optional(),
});
const loanProductSchema = z.object({
  id: z.number(),
  name: z.string(),
  shortName: z.string(),
  status: z.string(),
  currency: z.object({ code: z.string(), decimalPlaces: z.number().int() }),
  minPrincipal: z.number(),
  maxPrincipal: z.number(),
  annualInterestRate: z.number(),
  numberOfRepayments: z.number().int(),
  repaymentEvery: z.number().int(),
  repaymentFrequencyType: z.object({ value: z.string() }),
  amortizationType: z.object({ value: z.string() }),
  interestType: z.object({ value: z.string() }),
});
const ledgerAccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  glCode: z.string(),
  description: z.string().nullable().optional(),
  disabled: z.boolean(),
  manualEntriesAllowed: z.boolean(),
  type: z.object({ value: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]) }),
  usage: z.object({ value: z.enum(["HEADER", "DETAIL"]) }),
});

export async function importFoundation(prisma: PrismaClient, root: string, organizationName: string) {
  const manifest = await verifyArchive(root);
  const manifestBody = await readFile(path.join(root, "manifest.json"), "utf8");
  const manifestSha256 = createHash("sha256").update(manifestBody).digest("hex");
  const organization = await prisma.organization.upsert({
    where: { id: deterministicUuid(`organization:${manifest.sourceTenant}`) },
    create: { id: deterministicUuid(`organization:${manifest.sourceTenant}`), name: organizationName, baseCurrency: "UGX" },
    update: { name: organizationName },
  });
  const run = await prisma.migrationRun.create({
    data: { sourceSystem: manifest.sourceSystem, sourceTenant: manifest.sourceTenant, organizationId: organization.id, status: "IMPORTING", manifestSha256, startedAt: new Date() },
  });

  try {
    await seedPermissionGroups(prisma, organization.id);
    await seedSettlementCurrencies(prisma);
    for (const artifact of manifest.artifacts) {
      await prisma.migrationArtifact.create({ data: { runId: run.id, entityType: artifact.entity, sourcePath: artifact.file, pageNumber: artifact.page, recordCount: artifact.recordCount, sha256: artifact.sha256, filePath: path.resolve(root, artifact.file) } });
    }
    await importCurrencies(prisma, root, manifest.artifacts.filter((item) => item.entity === "currencies").map((item) => item.file));
    await importOffices(prisma, root, organization.id, manifest.artifacts.filter((item) => item.entity === "offices").map((item) => item.file), run.id);
    await importClients(prisma, root, organization.id, manifest.artifacts.filter((item) => item.entity === "clients").map((item) => item.file), run.id);
    await importLoanProducts(prisma, root, organization.id, manifest.artifacts.filter((item) => item.entity === "loanproducts").map((item) => item.file), run.id);
    await importLedgerAccounts(prisma, root, manifest.artifacts.filter((item) => item.entity === "glaccounts").map((item) => item.file), run.id);
    await prisma.migrationRun.update({ where: { id: run.id }, data: { status: "RECONCILING" } });
    const expectedOfficeCount = manifest.artifacts.filter((item) => item.entity === "offices").reduce((sum, item) => sum + item.recordCount, 0);
    const expectedClientCount = manifest.artifacts.filter((item) => item.entity === "clients").reduce((sum, item) => sum + item.recordCount, 0);
    const expectedProductCount = manifest.artifacts.filter((item) => item.entity === "loanproducts").reduce((sum, item) => sum + item.recordCount, 0);
    const expectedLedgerCount = manifest.artifacts.filter((item) => item.entity === "glaccounts").reduce((sum, item) => sum + item.recordCount, 0);
    const [artifactCount, officeCount, mappedOfficeCount, clientCount, mappedClientCount, productCount, mappedProductCount, ledgerCount, mappedLedgerCount, ugx] = await Promise.all([
      prisma.migrationArtifact.count({ where: { runId: run.id } }),
      prisma.office.count({ where: { organizationId: organization.id } }),
      prisma.migrationIdMap.count({ where: { runId: run.id, entityType: "office" } }),
      prisma.client.count({ where: { organizationId: organization.id } }),
      prisma.migrationIdMap.count({ where: { runId: run.id, entityType: "client" } }),
      prisma.loanProduct.count({ where: { organizationId: organization.id } }),
      prisma.migrationIdMap.count({ where: { runId: run.id, entityType: "loanProduct" } }),
      prisma.ledgerAccount.count({ where: { externalId: { not: null } } }),
      prisma.migrationIdMap.count({ where: { runId: run.id, entityType: "ledgerAccount" } }),
      prisma.currency.findUnique({ where: { code: "UGX" } }),
    ]);
    if (artifactCount !== manifest.artifacts.length) throw new Error(`Artifact reconciliation failed: ${artifactCount}/${manifest.artifacts.length}`);
    if (officeCount !== expectedOfficeCount || mappedOfficeCount !== expectedOfficeCount) throw new Error(`Office reconciliation failed: destination=${officeCount}, mapped=${mappedOfficeCount}, expected=${expectedOfficeCount}`);
    if (clientCount !== expectedClientCount || mappedClientCount !== expectedClientCount) throw new Error(`Client reconciliation failed: destination=${clientCount}, mapped=${mappedClientCount}, expected=${expectedClientCount}`);
    if (productCount !== expectedProductCount || mappedProductCount !== expectedProductCount) throw new Error(`Loan product reconciliation failed: destination=${productCount}, mapped=${mappedProductCount}, expected=${expectedProductCount}`);
    if (ledgerCount !== expectedLedgerCount || mappedLedgerCount !== expectedLedgerCount) throw new Error(`Ledger account reconciliation failed: destination=${ledgerCount}, mapped=${mappedLedgerCount}, expected=${expectedLedgerCount}`);
    if (!ugx || ugx.exponent !== 2) throw new Error(`Currency reconciliation failed: expected UGX exponent 2, got ${ugx?.exponent ?? "missing"}`);
    await prisma.migrationRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    return { runId: run.id, organizationId: organization.id, artifacts: manifest.artifacts.length };
  } catch (error) {
    await prisma.migrationRun.update({ where: { id: run.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

async function importLedgerAccounts(prisma: PrismaClient, root: string, files: string[], runId: string) {
  for (const file of files) {
    const accounts = z.array(ledgerAccountSchema).parse(JSON.parse(await readFile(path.join(root, file), "utf8")));
    for (const account of accounts) {
      const id = deterministicUuid(`ledgerAccount:UGX:${account.id}`);
      const values = {
        code: account.glCode,
        name: account.name,
        type: account.type.value === "INCOME" ? "REVENUE" as const : account.type.value,
        currencyCode: "UGX",
        externalId: String(account.id),
        usage: account.usage.value,
        description: account.description,
        manualEntriesAllowed: account.manualEntriesAllowed,
        active: !account.disabled,
      };
      await prisma.ledgerAccount.upsert({ where: { id }, create: { id, ...values }, update: values });
      await prisma.migrationIdMap.upsert({
        where: { runId_entityType_legacyId: { runId, entityType: "ledgerAccount", legacyId: String(account.id) } },
        create: { runId, entityType: "ledgerAccount", legacyId: String(account.id), sovlendId: id },
        update: { sovlendId: id },
      });
    }
  }
}

async function importLoanProducts(prisma: PrismaClient, root: string, organizationId: string, files: string[], runId: string) {
  for (const file of files) {
    const products = z.array(loanProductSchema).parse(JSON.parse(await readFile(path.join(root, file), "utf8")));
    for (const product of products) {
      const id = deterministicUuid(`loanProduct:${organizationId}:${product.id}`);
      const scale = new Decimal(10).pow(product.currency.decimalPlaces);
      const principalMinMinor = BigInt(new Decimal(product.minPrincipal).mul(scale).toFixed(0));
      const principalMaxMinor = BigInt(new Decimal(product.maxPrincipal).mul(scale).toFixed(0));
      const values = {
        organizationId,
        name: product.name,
        shortName: product.shortName,
        denominationCurrency: product.currency.code,
        principalMinMinor,
        principalMaxMinor,
        annualRateBps: new Decimal(product.annualInterestRate).mul(100).toDecimalPlaces(0).toNumber(),
        repaymentCount: product.numberOfRepayments,
        repaymentFrequency: `${product.repaymentEvery} ${product.repaymentFrequencyType.value}`,
        amortizationMethod: product.amortizationType.value,
        interestMethod: product.interestType.value,
        active: product.status === "loanProduct.active",
      };
      await prisma.loanProduct.upsert({ where: { id }, create: { id, ...values }, update: values });
      await prisma.migrationIdMap.upsert({
        where: { runId_entityType_legacyId: { runId, entityType: "loanProduct", legacyId: String(product.id) } },
        create: { runId, entityType: "loanProduct", legacyId: String(product.id), sovlendId: id },
        update: { sovlendId: id },
      });
    }
  }
}

async function seedSettlementCurrencies(prisma: PrismaClient) {
  for (const currency of [
    { code: "BTC", name: "Bitcoin", exponent: 8 },
    { code: "USD", name: "US Dollar", exponent: 2 },
    { code: "USDC", name: "USD Coin", exponent: 6 },
  ]) {
    await prisma.currency.upsert({ where: { code: currency.code }, create: currency, update: { name: currency.name, exponent: currency.exponent, active: true } });
  }
}

async function importClients(prisma: PrismaClient, root: string, organizationId: string, files: string[], runId: string) {
  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(root, file), "utf8")) as Record<string, unknown>;
    const clients = z.array(clientSchema).parse(payload.pageItems ?? []);
    for (const client of clients) {
      const id = deterministicUuid(`client:${organizationId}:${client.id}`);
      const officeId = deterministicUuid(`office:${organizationId}:${client.officeId}`);
      const fallbackNames = splitDisplayName(client.displayName);
      await prisma.client.upsert({
        where: { id },
        create: {
          id,
          organizationId,
          officeId,
          accountNumber: client.accountNo,
          externalId: client.externalId,
          firstName: client.firstname ?? fallbackNames.firstName,
          middleName: client.middlename,
          lastName: client.lastname ?? fallbackNames.lastName,
          mobileNumber: client.mobileNo,
          dateOfBirth: toDate(client.dateOfBirth),
          genderCode: client.gender?.name,
          clientTypeCode: client.clientType?.name,
          classificationCode: client.clientClassification?.name,
          isStaff: client.isStaff ?? false,
          status: client.status.code === "clientStatusType.active" ? "ACTIVE" : "SUBMITTED",
          kycStatus: "INCOMPLETE",
          submittedOn: toDate(client.timeline?.submittedOnDate),
          activatedOn: toDate(client.activationDate),
        },
        update: {
          officeId,
          accountNumber: client.accountNo,
          externalId: client.externalId,
          firstName: client.firstname ?? fallbackNames.firstName,
          middleName: client.middlename,
          lastName: client.lastname ?? fallbackNames.lastName,
          mobileNumber: client.mobileNo,
          dateOfBirth: toDate(client.dateOfBirth),
          genderCode: client.gender?.name,
          clientTypeCode: client.clientType?.name,
          classificationCode: client.clientClassification?.name,
          isStaff: client.isStaff ?? false,
          status: client.status.code === "clientStatusType.active" ? "ACTIVE" : "SUBMITTED",
          submittedOn: toDate(client.timeline?.submittedOnDate),
          activatedOn: toDate(client.activationDate),
        },
      });
      await prisma.migrationIdMap.upsert({
        where: { runId_entityType_legacyId: { runId, entityType: "client", legacyId: String(client.id) } },
        create: { runId, entityType: "client", legacyId: String(client.id), sovlendId: id },
        update: { sovlendId: id },
      });
    }
  }
}

async function importCurrencies(prisma: PrismaClient, root: string, files: string[]) {
  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(root, file), "utf8")) as Record<string, unknown>;
    const currencies = z.array(currencySchema).parse(payload.selectedCurrencyOptions ?? []);
    for (const currency of currencies) {
      await prisma.currency.upsert({ where: { code: currency.code }, create: { code: currency.code, name: currency.name, exponent: currency.decimalPlaces }, update: { name: currency.name, exponent: currency.decimalPlaces, active: true } });
    }
  }
}

async function importOffices(prisma: PrismaClient, root: string, organizationId: string, files: string[], runId: string) {
  const offices: z.infer<typeof officeSchema>[] = [];
  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(root, file), "utf8"));
    offices.push(...z.array(officeSchema).parse(payload));
  }
  const sorted = offices.sort((left, right) => left.hierarchy.split(".").length - right.hierarchy.split(".").length);
  const idMap = new Map<number, string>();
  const rootLegacyId = sorted.find((office) => office.hierarchy === ".")?.id ?? null;
  for (const office of sorted) {
    const id = deterministicUuid(`office:${organizationId}:${office.id}`);
    const parentLegacyId = office.hierarchy === "." ? null : parentFromHierarchy(office.hierarchy) ?? rootLegacyId;
    await prisma.office.upsert({
      where: { id },
      create: { id, organizationId, parentId: parentLegacyId ? idMap.get(parentLegacyId) : null, name: office.name, externalId: office.externalId ?? String(office.id) },
      update: { name: office.name, externalId: office.externalId ?? String(office.id), parentId: parentLegacyId ? idMap.get(parentLegacyId) : null },
    });
    idMap.set(office.id, id);
    await prisma.migrationIdMap.upsert({
      where: { runId_entityType_legacyId: { runId, entityType: "office", legacyId: String(office.id) } },
      create: { runId, entityType: "office", legacyId: String(office.id), sovlendId: id },
      update: { sovlendId: id },
    });
  }
}

function parentFromHierarchy(hierarchy: string) {
  const parts = hierarchy.split(".").filter(Boolean).map(Number);
  return parts.length > 1 ? parts.at(-2) ?? null : null;
}

function deterministicUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function toDate(value: [number, number, number] | null | undefined) {
  return value ? new Date(Date.UTC(value[0], value[1] - 1, value[2])) : null;
}

function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/);
  return { firstName: parts.shift() ?? displayName, lastName: parts.join(" ") || "Unknown" };
}
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import { storeDocumentBytes } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";

import { ReadOnlyFineractClient } from "./fineract-client";

const DEFAULT_CLIENT_ARCHIVE_DIR = path.join(process.cwd(), ".migration-data", "ilend-full-archive-20260903", "raw", "clients");
const PROGRESS_INTERVAL = 100;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getStaggerMs(environment: NodeJS.ProcessEnv) {
  const parsed = Number.parseInt(environment.MIGRATION_STAGGER_MS ?? "150", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 150;
}

function getClientArchiveDir(environment: NodeJS.ProcessEnv) {
  return environment.MIGRATION_CLIENT_ARCHIVE_DIR ?? DEFAULT_CLIENT_ARCHIVE_DIR;
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function documentIdentity(name: string, description: string | null) {
  return JSON.stringify([name, description ?? null]);
}

async function loadLegacyClientIdByAccountNumber(directory: string) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));

  const lookup = new Map<string, number>();

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const payload = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    const pageItems = Array.isArray(payload.pageItems) ? payload.pageItems : [];

    for (const raw of pageItems) {
      const client = raw as Record<string, unknown>;
      const legacyClientId = num(client.id);
      const accountNumber = str(client.accountNo);
      if (legacyClientId === null || !accountNumber) continue;

      const existing = lookup.get(accountNumber);
      if (existing !== undefined && existing !== legacyClientId) {
        throw new Error(`Conflicting legacy client ids for account ${accountNumber}: ${existing} vs ${legacyClientId}`);
      }

      lookup.set(accountNumber, legacyClientId);
    }
  }

  return lookup;
}

export async function importClientDocuments(
  prisma: PrismaClient,
  fineract: ReadOnlyFineractClient,
): Promise<{
  clientsProcessed: number;
  lookupEntries: number;
  clientsWithDocuments: number;
  documentsImported: number;
  documentsAlreadyPresent: number;
  documentsFailed: number;
  unmappedClients: string[];
  clientErrors: string[];
}> {
  const staggerMs = getStaggerMs(process.env);
  const archiveDir = getClientArchiveDir(process.env);
  const legacyClientIdByAccountNumber = await loadLegacyClientIdByAccountNumber(archiveDir);
  const clients = await prisma.client.findMany({
    select: { id: true, accountNumber: true },
    orderBy: { accountNumber: "asc" },
  });

  let clientsWithDocuments = 0;
  let documentsImported = 0;
  let documentsAlreadyPresent = 0;
  let documentsFailed = 0;
  const unmappedClients: string[] = [];
  const clientErrors: string[] = [];

  for (const [index, client] of clients.entries()) {
    const legacyClientId = legacyClientIdByAccountNumber.get(client.accountNumber);
    if (legacyClientId === undefined) {
      unmappedClients.push(client.accountNumber);
      continue;
    }

    try {
      const listedDocuments = await fineract.getClientSubResource(legacyClientId, "documents");
      await sleep(staggerMs);

      const documents = Array.isArray(listedDocuments) ? listedDocuments : [];
      if (documents.length > 0) clientsWithDocuments += 1;

      const existingDocuments = await prisma.document.findMany({
        where: { clientId: client.id },
        select: { name: true, description: true },
      });
      const existingDocumentCounts = new Map<string, number>();
      for (const document of existingDocuments) {
        const key = documentIdentity(document.name, document.description);
        existingDocumentCounts.set(key, (existingDocumentCounts.get(key) ?? 0) + 1);
      }
      const seenDocumentCounts = new Map<string, number>();

      for (const raw of documents) {
        const document = raw as Record<string, unknown>;
        const documentId = num(document.id);
        if (documentId === null) continue;

        const name = str(document.name) ?? str(document.fileName) ?? `Document ${documentId}`;
        const description = str(document.description);
        const identity = documentIdentity(name, description);

        const seenCount = (seenDocumentCounts.get(identity) ?? 0) + 1;
        seenDocumentCounts.set(identity, seenCount);

        if (seenCount <= (existingDocumentCounts.get(identity) ?? 0)) {
          documentsAlreadyPresent += 1;
          continue;
        }

        try {
          const { bytes, contentType } = await fineract.downloadClientDocument(legacyClientId, documentId);
          const sha256 = await storeDocumentBytes(bytes);
          const existingByObjectKey = await prisma.document.findUnique({
            where: { objectKey: sha256 },
            select: { clientId: true, loanId: true },
          });
          if (existingByObjectKey?.clientId === client.id) {
            documentsAlreadyPresent += 1;
            continue;
          }
          if (existingByObjectKey) {
            throw new Error(
              `Document bytes already linked to ${existingByObjectKey.clientId ? `client ${existingByObjectKey.clientId}` : `loan ${existingByObjectKey.loanId}`}`,
            );
          }
          await prisma.document.create({
            data: {
              clientId: client.id,
              name,
              description,
              objectKey: sha256,
              sha256,
              mediaType: str(document.type) ?? contentType,
            },
          });
          documentsImported += 1;
        } catch (error) {
          documentsFailed += 1;
          clientErrors.push(`${client.accountNumber} document ${documentId}: ${errorMessage(error)}`);
        }

        await sleep(staggerMs);
      }
    } catch (error) {
      clientErrors.push(`${client.accountNumber}: failed to list documents (${errorMessage(error)})`);
      await sleep(staggerMs);
    }

    const processed = index + 1;
    if (processed % PROGRESS_INTERVAL === 0 || processed === clients.length) {
      console.log(
        `Processed ${processed}/${clients.length} clients; imported ${documentsImported}, already present ${documentsAlreadyPresent}, failed ${documentsFailed}.`,
      );
    }
  }

  return {
    clientsProcessed: clients.length,
    lookupEntries: legacyClientIdByAccountNumber.size,
    clientsWithDocuments,
    documentsImported,
    documentsAlreadyPresent,
    documentsFailed,
    unmappedClients,
    clientErrors,
  };
}

async function main() {
  const baseUrl = required(process.env, "LEGACY_BASE_URL");
  const tenantId = required(process.env, "LEGACY_TENANT_ID");
  const username = required(process.env, "LEGACY_USERNAME");
  const password = required(process.env, "LEGACY_PASSWORD");
  const fineract = new ReadOnlyFineractClient(baseUrl, tenantId, username, password);

  try {
    const result = await importClientDocuments(prisma, fineract);
    console.log("Client document import complete.");
    console.log(`Clients processed: ${result.clientsProcessed}`);
    console.log(`Archive lookup entries: ${result.lookupEntries}`);
    console.log(`Clients with listed documents: ${result.clientsWithDocuments}`);
    console.log(`Documents imported: ${result.documentsImported}`);
    console.log(`Documents already present: ${result.documentsAlreadyPresent}`);
    console.log(`Documents failed: ${result.documentsFailed}`);
    console.log(`Unmapped clients: ${result.unmappedClients.length}`);
    console.log(`Client errors: ${result.clientErrors.length}`);
    if (result.unmappedClients.length > 0) console.log(`Unmapped account numbers:\n${result.unmappedClients.join("\n")}`);
    if (result.clientErrors.length > 0) console.log(`Errors:\n${result.clientErrors.join("\n")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

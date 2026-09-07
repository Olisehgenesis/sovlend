import type { PrismaClient } from "@prisma/client";

import { storeDocumentBytes } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";

import { ReadOnlyFineractClient } from "./fineract-client";

const LEGACY_ACCOUNT_PREFIX = "LEGACY-";

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

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function importLoanDocuments(
  prisma: PrismaClient,
  fineract: ReadOnlyFineractClient,
): Promise<{ loansProcessed: number; documentsImported: number; documentsSkipped: string[] }> {
  const staggerMs = getStaggerMs(process.env);
  const loans = await prisma.loan.findMany({
    where: { accountNumber: { startsWith: LEGACY_ACCOUNT_PREFIX } },
    select: { id: true, accountNumber: true },
    orderBy: { createdAt: "asc" },
  });

  let documentsImported = 0;
  const documentsSkipped: string[] = [];

  for (const loan of loans) {
    const legacyLoanId = Number(loan.accountNumber.replace(LEGACY_ACCOUNT_PREFIX, ""));
    if (!Number.isInteger(legacyLoanId) || legacyLoanId <= 0) {
      documentsSkipped.push(`${loan.accountNumber}: invalid legacy loan id`);
      continue;
    }

    let listedDocuments: unknown;
    try {
      listedDocuments = await fineract.getLoanDocuments(legacyLoanId);
    } catch (error) {
      documentsSkipped.push(`${loan.accountNumber}: failed to list documents (${errorMessage(error)})`);
      await sleep(staggerMs);
      continue;
    }
    await sleep(staggerMs);

    const documents = Array.isArray(listedDocuments) ? listedDocuments : [];
    for (const raw of documents) {
      const document = raw as Record<string, unknown>;
      const documentId = num(document.id);
      if (documentId === null) continue;

      const name = str(document.name) ?? str(document.fileName) ?? `Document ${documentId}`;
      const existing = await prisma.document.findFirst({ where: { loanId: loan.id, name } });
      if (existing) continue;

      try {
        const { bytes, contentType } = await fineract.downloadLoanDocument(legacyLoanId, documentId);
        const sha256 = await storeDocumentBytes(bytes);
        await prisma.document.create({
          data: {
            loanId: loan.id,
            name,
            description: str(document.description),
            objectKey: sha256,
            sha256,
            mediaType: str(document.type) ?? contentType,
          },
        });
        documentsImported += 1;
      } catch (error) {
        documentsSkipped.push(`${loan.accountNumber} document ${documentId}: ${errorMessage(error)}`);
      }

      await sleep(staggerMs);
    }
  }

  return { loansProcessed: loans.length, documentsImported, documentsSkipped };
}

async function main() {
  const baseUrl = required(process.env, "LEGACY_BASE_URL");
  const tenantId = required(process.env, "LEGACY_TENANT_ID");
  const username = required(process.env, "LEGACY_USERNAME");
  const password = required(process.env, "LEGACY_PASSWORD");
  const fineract = new ReadOnlyFineractClient(baseUrl, tenantId, username, password);

  try {
    const result = await importLoanDocuments(prisma, fineract);
    console.log("Loan document import complete.");
    console.log(`Loans processed: ${result.loansProcessed}`);
    console.log(`Documents imported: ${result.documentsImported}`);
    console.log(`Documents skipped: ${result.documentsSkipped.length}`);
    if (result.documentsSkipped.length > 0) console.log(`Skip reasons:\n${result.documentsSkipped.join("\n")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

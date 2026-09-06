import type { PrismaClient } from "@prisma/client";

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

function dateFromLegacyTimestamp(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const createdAt = new Date(value);
    return Number.isNaN(createdAt.getTime()) ? null : createdAt;
  }

  if (Array.isArray(value) && value.length >= 3) {
    const [year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0] = value;
    if (![year, month, day, hour, minute, second, millisecond].every((part) => typeof part === "number" && Number.isFinite(part))) {
      return null;
    }
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  }

  return null;
}

function buildImportedBody(note: Record<string, unknown>, createdAt: Date): string | null {
  const noteId = num(note.id);
  const noteText = str(note.note);
  if (!noteText) return null;

  const createdByUsername = str(note.createdByUsername) ?? "legacy";
  const legacyIdLabel = noteId === null ? "unknown" : String(noteId);
  return `[iLend note #${legacyIdLabel} by ${createdByUsername} at ${createdAt.toISOString()}] ${noteText}`;
}

export async function importLoanNotes(
  prisma: PrismaClient,
  fineract: ReadOnlyFineractClient,
): Promise<{ loansProcessed: number; notesImported: number; notesSkippedAsDuplicate: number; loansErrored: string[] }> {
  const staggerMs = getStaggerMs(process.env);
  const actor = await prisma.user.findFirstOrThrow({
    where: { email: "testadmin@sovlend.com" },
    select: { id: true },
  });
  const loans = await prisma.loan.findMany({
    where: { accountNumber: { startsWith: LEGACY_ACCOUNT_PREFIX } },
    select: { id: true, accountNumber: true },
    orderBy: { createdAt: "asc" },
  });

  let notesImported = 0;
  let notesSkippedAsDuplicate = 0;
  const loansErrored: string[] = [];

  for (const [index, loan] of loans.entries()) {
    const legacyLoanId = Number(loan.accountNumber.replace(LEGACY_ACCOUNT_PREFIX, ""));
    if (!Number.isInteger(legacyLoanId) || legacyLoanId <= 0) {
      loansErrored.push(`${loan.accountNumber}: invalid legacy loan id`);
      continue;
    }

    try {
      const listedNotes = await fineract.getLoanNotes(legacyLoanId);
      const notes = Array.isArray(listedNotes) ? listedNotes : [];

      for (const raw of notes) {
        const note = raw as Record<string, unknown>;
        const createdAt = dateFromLegacyTimestamp(note.createdOn) ?? dateFromLegacyTimestamp(note.createdDate) ?? dateFromLegacyTimestamp(note.updatedOn);
        const body = createdAt ? buildImportedBody(note, createdAt) : null;
        if (!createdAt || !body) continue;

        // LoanNote has no legacy-note unique key, so we reuse the exact imported body + historical createdAt
        // as a deterministic natural key; the body embeds the legacy note id to distinguish same-text notes.
        const existing = await prisma.loanNote.findFirst({
          where: { loanId: loan.id, body, createdAt },
          select: { id: true },
        });
        if (existing) {
          notesSkippedAsDuplicate += 1;
          continue;
        }

        await prisma.loanNote.create({
          data: {
            loanId: loan.id,
            authorId: actor.id,
            body,
            createdAt,
          },
        });
        notesImported += 1;
      }
    } catch (error) {
      loansErrored.push(`${loan.accountNumber}: failed to import notes (${errorMessage(error)})`);
    }

    await sleep(staggerMs);
    const loansProcessed = index + 1;
    if (loansProcessed % 50 === 0 || loansProcessed === loans.length) {
      console.log(
        `[import-loan-notes] Processed ${loansProcessed}/${loans.length} loans (${notesImported} imported, ${notesSkippedAsDuplicate} duplicates skipped, ${loansErrored.length} errored)`,
      );
    }
  }

  return { loansProcessed: loans.length, notesImported, notesSkippedAsDuplicate, loansErrored };
}

async function main() {
  const baseUrl = required(process.env, "LEGACY_BASE_URL");
  const tenantId = required(process.env, "LEGACY_TENANT_ID");
  const username = required(process.env, "LEGACY_USERNAME");
  const password = required(process.env, "LEGACY_PASSWORD");
  const fineract = new ReadOnlyFineractClient(baseUrl, tenantId, username, password);

  try {
    const result = await importLoanNotes(prisma, fineract);
    console.log("Loan note import complete.");
    console.log(`Loans processed: ${result.loansProcessed}`);
    console.log(`Notes imported: ${result.notesImported}`);
    console.log(`Notes skipped as duplicate: ${result.notesSkippedAsDuplicate}`);
    console.log(`Loans errored: ${result.loansErrored.length}`);
    if (result.loansErrored.length > 0) console.log(`Loan errors:\n${result.loansErrored.join("\n")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

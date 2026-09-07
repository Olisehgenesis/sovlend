import "dotenv/config";

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

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

function dateFromLegacyDob(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value;
  if (![year, month, day].every((part) => typeof part === "number" && Number.isFinite(part))) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export async function importLoanGuarantors(
  prisma: PrismaClient,
  fineract: ReadOnlyFineractClient,
): Promise<{
  loansProcessed: number;
  guarantorsCreated: number;
  guarantorsUpdated: number;
  guarantorsSkippedOrErrored: number;
  loanErrors: string[];
}> {
  const staggerMs = getStaggerMs(process.env);
  const loans = await prisma.loan.findMany({
    where: { accountNumber: { startsWith: LEGACY_ACCOUNT_PREFIX } },
    select: { id: true, accountNumber: true },
    orderBy: { createdAt: "asc" },
  });

  let guarantorsCreated = 0;
  let guarantorsUpdated = 0;
  let guarantorsSkippedOrErrored = 0;
  const loanErrors: string[] = [];

  for (const [index, loan] of loans.entries()) {
    const legacyLoanId = Number(loan.accountNumber.replace(LEGACY_ACCOUNT_PREFIX, ""));
    if (!Number.isInteger(legacyLoanId) || legacyLoanId <= 0) {
      loanErrors.push(`${loan.accountNumber}: invalid legacy loan id`);
      guarantorsSkippedOrErrored += 1;
      continue;
    }

    try {
      const listedGuarantors = await fineract.getLoanGuarantors(legacyLoanId);
      const guarantors = Array.isArray(listedGuarantors) ? listedGuarantors : [];

      for (const raw of guarantors) {
        try {
          const guarantor = record(raw);
          const externalId = num(guarantor?.id);
          if (!guarantor || externalId === null) {
            guarantorsSkippedOrErrored += 1;
            continue;
          }

          const guarantorType = str(record(guarantor.guarantorType)?.value) ?? "EXTERNAL";
          const relationship = str(record(guarantor.clientRelationshipType)?.name);
          const existing = await prisma.guarantor.findUnique({
            where: { externalId },
            select: { id: true },
          });

          await prisma.guarantor.upsert({
            where: { externalId },
            update: {
              loanId: loan.id,
              guarantorType,
              firstName: str(guarantor.firstname),
              lastName: str(guarantor.lastname),
              phone: str(guarantor.mobileNumber),
              relationship,
              dateOfBirth: dateFromLegacyDob(guarantor.dob),
              active: bool(guarantor.status) ?? true,
            },
            create: {
              loanId: loan.id,
              externalId,
              guarantorType,
              firstName: str(guarantor.firstname),
              lastName: str(guarantor.lastname),
              phone: str(guarantor.mobileNumber),
              relationship,
              dateOfBirth: dateFromLegacyDob(guarantor.dob),
              active: bool(guarantor.status) ?? true,
            },
          });

          if (existing) guarantorsUpdated += 1;
          else guarantorsCreated += 1;
        } catch (error) {
          guarantorsSkippedOrErrored += 1;
          const guarantorId = num(record(raw)?.id);
          loanErrors.push(`${loan.accountNumber} guarantor ${guarantorId ?? "unknown"}: ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      guarantorsSkippedOrErrored += 1;
      loanErrors.push(`${loan.accountNumber}: failed to import guarantors (${errorMessage(error)})`);
    }

    await sleep(staggerMs);
    const loansProcessed = index + 1;
    if (loansProcessed % 50 === 0 || loansProcessed === loans.length) {
      console.log(
        `[import-loan-guarantors] Processed ${loansProcessed}/${loans.length} loans (${guarantorsCreated} created, ${guarantorsUpdated} updated, ${guarantorsSkippedOrErrored} skipped/errored)`,
      );
    }
  }

  return {
    loansProcessed: loans.length,
    guarantorsCreated,
    guarantorsUpdated,
    guarantorsSkippedOrErrored,
    loanErrors,
  };
}

async function main() {
  const baseUrl = required(process.env, "LEGACY_BASE_URL");
  const tenantId = required(process.env, "LEGACY_TENANT_ID");
  const username = required(process.env, "LEGACY_USERNAME");
  const password = required(process.env, "LEGACY_PASSWORD");
  const fineract = new ReadOnlyFineractClient(baseUrl, tenantId, username, password);

  try {
    const result = await importLoanGuarantors(prisma, fineract);
    console.log("Loan guarantor import complete.");
    console.log(`Loans processed: ${result.loansProcessed}`);
    console.log(`Guarantors created: ${result.guarantorsCreated}`);
    console.log(`Guarantors updated: ${result.guarantorsUpdated}`);
    console.log(`Guarantors skipped/errored: ${result.guarantorsSkippedOrErrored}`);
    console.log(`Loan errors: ${result.loanErrors.length}`);
    if (result.loanErrors.length > 0) console.log(`Loan errors:\n${result.loanErrors.join("\n")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

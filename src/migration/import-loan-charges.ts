import Decimal from "decimal.js";
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

function toMinor(amount: number, exponent = 2): bigint {
  return BigInt(new Decimal(amount).mul(new Decimal(10).pow(exponent)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value as number[];
  return new Date(Date.UTC(year, month - 1, day));
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

function chargeStatus(charge: Record<string, unknown>) {
  const waived = charge.waived === true;
  const paid = charge.paid === true;
  const outstanding = num(charge.amountOutstanding);
  if (waived) return "WAIVED";
  if (paid || outstanding === 0) return "PAID";
  return "PENDING";
}

function chargeKey(name: string, amountMinor: bigint, dueOn: Date | null) {
  return `${name}\u0000${amountMinor.toString()}\u0000${dueOn?.toISOString().slice(0, 10) ?? "null"}`;
}

export async function importLoanCharges(
  prisma: PrismaClient,
  fineract: ReadOnlyFineractClient,
): Promise<{ loansProcessed: number; chargesImported: number; chargesSkippedAsAlreadyImported: number; loansErrored: string[] }> {
  const staggerMs = getStaggerMs(process.env);
  const loans = await prisma.loan.findMany({
    where: { accountNumber: { startsWith: LEGACY_ACCOUNT_PREFIX } },
    select: { id: true, accountNumber: true, denominationCurrency: true },
    orderBy: { createdAt: "asc" },
  });

  let chargesImported = 0;
  let chargesSkippedAsAlreadyImported = 0;
  const loansErrored: string[] = [];

  for (const loan of loans) {
    const legacyLoanId = Number(loan.accountNumber.replace(LEGACY_ACCOUNT_PREFIX, ""));
    if (!Number.isInteger(legacyLoanId) || legacyLoanId <= 0) {
      loansErrored.push(`${loan.accountNumber}: invalid legacy loan id`);
      continue;
    }

    try {
      const payload = (await fineract.getLoanWithCharges(legacyLoanId)) as { charges?: unknown };
      const rawCharges = Array.isArray(payload.charges) ? payload.charges : [];
      const existingCharges = await prisma.charge.findMany({
        where: { loanId: loan.id },
        select: { name: true, amountMinor: true, dueOn: true },
      });
      const existingCounts = new Map<string, number>();
      for (const existingCharge of existingCharges) {
        const key = chargeKey(existingCharge.name, existingCharge.amountMinor, existingCharge.dueOn);
        existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
      }

      for (const rawCharge of rawCharges) {
        const charge = rawCharge as Record<string, unknown>;
        const name = str(charge.name) ?? `Charge ${String(charge.id ?? "unknown")}`;
        const amount = num(charge.amount) ?? 0;
        const currency = (charge.currency as Record<string, unknown> | undefined)?.code;
        const exponent = Number((charge.currency as Record<string, unknown> | undefined)?.decimalPlaces ?? 2);
        const amountMinor = toMinor(amount, Number.isFinite(exponent) ? exponent : 2);
        const dueOn = dateFromParts(charge.dueDate) ?? dateFromParts(charge.dueAsOfDate);
        const key = chargeKey(name, amountMinor, dueOn);
        const existingCount = existingCounts.get(key) ?? 0;

        // Charge has no legacy-id column, so idempotency is enforced by consuming the
        // existing count for a deterministic (loan, name, amount, due date) tuple.
        if (existingCount > 0) {
          existingCounts.set(key, existingCount - 1);
          chargesSkippedAsAlreadyImported += 1;
          continue;
        }

        await prisma.charge.create({
          data: {
            loanId: loan.id,
            name,
            amountMinor,
            currencyCode: typeof currency === "string" && currency.trim() ? currency : loan.denominationCurrency || "UGX",
            status: chargeStatus(charge),
            dueOn,
          },
        });
        chargesImported += 1;
      }
    } catch (error) {
      loansErrored.push(`${loan.accountNumber}: ${errorMessage(error)}`);
    }

    await sleep(staggerMs);
  }

  return { loansProcessed: loans.length, chargesImported, chargesSkippedAsAlreadyImported, loansErrored };
}

async function main() {
  const baseUrl = required(process.env, "LEGACY_BASE_URL");
  const tenantId = required(process.env, "LEGACY_TENANT_ID");
  const username = required(process.env, "LEGACY_USERNAME");
  const password = required(process.env, "LEGACY_PASSWORD");
  const fineract = new ReadOnlyFineractClient(baseUrl, tenantId, username, password);

  try {
    const result = await importLoanCharges(prisma, fineract);
    console.log("Loan charge import complete.");
    console.log(`Loans processed: ${result.loansProcessed}`);
    console.log(`Charges imported: ${result.chargesImported}`);
    console.log(`Charges skipped as already imported: ${result.chargesSkippedAsAlreadyImported}`);
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

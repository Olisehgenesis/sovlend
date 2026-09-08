import type { PrismaClient, UserRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { deterministicUuid } from "./import-foundation";
import { ReadOnlyFineractClient } from "./fineract-client";

const LEGACY_ACCOUNT_PREFIX = "LEGACY-";

type StaffRecord = {
  id?: number;
  displayName?: string;
  firstname?: string;
  lastname?: string;
  officeId?: number;
  isLoanOfficer?: boolean;
};

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

export type BackfillOfficerAssignmentsResult = Readonly<{
  staffImported: number;
  loansProcessed: number;
  loansUpdated: number;
  loansErrored: readonly string[];
  savingsProcessed: number;
  savingsUpdated: number;
  savingsErrored: readonly string[];
}>;

/**
 * One-time, idempotent, live-API backfill that fills in the officer/attribution links the original
 * migration dropped: `Loan.loanOfficerId` and `SavingsAccount.fieldOfficerId` were never set because
 * iLend's staff roster was never imported as SovLend `User` records, and iLend's client/group
 * "accounts" summary endpoint (used for the original bulk import) doesn't include officer fields at
 * all -- only the per-loan/per-savings-account detail endpoints do. This must therefore call the
 * legacy API directly per account (read-only GETs, no writes to iLend) rather than replay a local
 * archive. Safe to re-run: staff upserts are keyed by a deterministic UUID, and loan/savings updates
 * are unconditional single-column writes that converge to the same result each run.
 */
export async function backfillOfficerAssignments(
  prisma: PrismaClient,
  fineract: ReadOnlyFineractClient,
): Promise<BackfillOfficerAssignmentsResult> {
  const staggerMs = getStaggerMs(process.env);
  const organization = await prisma.organization.findFirstOrThrow({ select: { id: true } });
  const organizationId = organization.id;

  // Step 1: import the legacy staff roster as User records (attribution only -- these are not
  // login accounts). Keyed by a deterministic UUID so this step is idempotent and needs no id-map.
  const staffList = ((await fineract.getStaff()) as StaffRecord[] | undefined) ?? [];
  const staffIdToUserId = new Map<number, string>();
  let staffImported = 0;

  for (const staff of staffList) {
    const legacyStaffId = Number(staff.id);
    if (!Number.isFinite(legacyStaffId)) continue;

    const userId = deterministicUuid(`staff:${organizationId}:${legacyStaffId}`);
    const name = (staff.displayName ?? `${staff.firstname ?? ""} ${staff.lastname ?? ""}`).trim() || `Staff #${legacyStaffId}`;
    const email = `legacy-staff-${legacyStaffId}@jumpstart.import.internal`;
    const officeId = staff.officeId != null ? deterministicUuid(`office:${organizationId}:${staff.officeId}`) : null;
    const office = officeId ? await prisma.office.findUnique({ where: { id: officeId }, select: { id: true } }) : null;
    const systemRole: UserRole = staff.isLoanOfficer ? "LOAN_OFFICER" : "TELLER";

    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        name,
        email,
        emailVerified: false,
        organizationId,
        officeId: office?.id ?? null,
        systemRole,
      },
      update: { name, officeId: office?.id ?? null },
    });
    staffIdToUserId.set(legacyStaffId, userId);
    staffImported += 1;
  }
  console.log(`[backfill-officer-assignments] Imported/updated ${staffImported} staff user(s).`);

  // Step 2: backfill Loan.loanOfficerId from the live per-loan detail endpoint.
  const loans = await prisma.loan.findMany({
    where: { accountNumber: { startsWith: LEGACY_ACCOUNT_PREFIX } },
    select: { id: true, accountNumber: true, loanOfficerId: true },
    orderBy: { createdAt: "asc" },
  });

  let loansUpdated = 0;
  const loansErrored: string[] = [];

  for (const [index, loan] of loans.entries()) {
    const legacyLoanId = Number(loan.accountNumber.replace(LEGACY_ACCOUNT_PREFIX, ""));
    if (!Number.isInteger(legacyLoanId) || legacyLoanId <= 0) {
      loansErrored.push(`${loan.accountNumber}: invalid legacy loan id`);
      continue;
    }

    try {
      const detail = (await fineract.getLoanSummary(legacyLoanId)) as { loanOfficerId?: number };
      const legacyOfficerId = detail.loanOfficerId != null ? Number(detail.loanOfficerId) : null;
      const officerUserId = legacyOfficerId != null ? (staffIdToUserId.get(legacyOfficerId) ?? null) : null;

      if (officerUserId && officerUserId !== loan.loanOfficerId) {
        await prisma.loan.update({ where: { id: loan.id }, data: { loanOfficerId: officerUserId } });
        loansUpdated += 1;
      }
    } catch (error) {
      loansErrored.push(`${loan.accountNumber}: ${errorMessage(error)}`);
    }

    await sleep(staggerMs);
    const processed = index + 1;
    if (processed % 50 === 0 || processed === loans.length) {
      console.log(`[backfill-officer-assignments] Loans processed ${processed}/${loans.length} (${loansUpdated} updated, ${loansErrored.length} errored)`);
    }
  }

  // Step 3: backfill SavingsAccount.fieldOfficerId from the live per-account detail endpoint. The
  // legacy savings account id was preserved verbatim in termsSnapshot.id at import time, so no
  // account-number parsing/guessing is needed here.
  const savingsAccounts = await prisma.savingsAccount.findMany({
    select: { id: true, accountNumber: true, fieldOfficerId: true, termsSnapshot: true },
    orderBy: { createdAt: "asc" },
  });

  let savingsUpdated = 0;
  const savingsErrored: string[] = [];

  for (const [index, account] of savingsAccounts.entries()) {
    const snapshot = account.termsSnapshot as { id?: number } | null;
    const legacySavingsId = snapshot?.id != null ? Number(snapshot.id) : null;
    if (!legacySavingsId || !Number.isInteger(legacySavingsId) || legacySavingsId <= 0) {
      savingsErrored.push(`${account.accountNumber}: no legacy savings id in termsSnapshot`);
      continue;
    }

    try {
      const detail = (await fineract.getSavingsAccount(legacySavingsId)) as { fieldOfficerId?: number };
      const legacyOfficerId = detail.fieldOfficerId != null ? Number(detail.fieldOfficerId) : null;
      const officerUserId = legacyOfficerId != null ? (staffIdToUserId.get(legacyOfficerId) ?? null) : null;

      if (officerUserId && officerUserId !== account.fieldOfficerId) {
        await prisma.savingsAccount.update({ where: { id: account.id }, data: { fieldOfficerId: officerUserId } });
        savingsUpdated += 1;
      }
    } catch (error) {
      savingsErrored.push(`${account.accountNumber}: ${errorMessage(error)}`);
    }

    await sleep(staggerMs);
    const processed = index + 1;
    if (processed % 50 === 0 || processed === savingsAccounts.length) {
      console.log(
        `[backfill-officer-assignments] Savings accounts processed ${processed}/${savingsAccounts.length} (${savingsUpdated} updated, ${savingsErrored.length} errored)`,
      );
    }
  }

  return {
    staffImported,
    loansProcessed: loans.length,
    loansUpdated,
    loansErrored,
    savingsProcessed: savingsAccounts.length,
    savingsUpdated,
    savingsErrored,
  };
}

async function main() {
  const baseUrl = required(process.env, "LEGACY_BASE_URL");
  const tenantId = required(process.env, "LEGACY_TENANT_ID");
  const username = required(process.env, "LEGACY_USERNAME");
  const password = required(process.env, "LEGACY_PASSWORD");
  const fineract = new ReadOnlyFineractClient(baseUrl, tenantId, username, password);

  try {
    const result = await backfillOfficerAssignments(prisma, fineract);
    console.log("Officer assignment backfill complete.");
    console.log(`Staff imported/updated: ${result.staffImported}`);
    console.log(`Loans processed: ${result.loansProcessed}, updated: ${result.loansUpdated}, errored: ${result.loansErrored.length}`);
    if (result.loansErrored.length > 0) console.log(`Loan errors:\n${result.loansErrored.join("\n")}`);
    console.log(`Savings accounts processed: ${result.savingsProcessed}, updated: ${result.savingsUpdated}, errored: ${result.savingsErrored.length}`);
    if (result.savingsErrored.length > 0) console.log(`Savings errors:\n${result.savingsErrored.join("\n")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

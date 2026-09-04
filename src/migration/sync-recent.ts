import { PrismaClient, type LoanStatus, type Prisma } from "@prisma/client";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { extractLegacy } from "./extract";
import { extractLegacyLoanHistory } from "./extract-loans";
import { importArchiveGroupsAndLoans } from "./import-archive-loans";
import { importFoundation } from "./import-foundation";

type CountSnapshot = {
  clients: number;
  groups: number;
  groupMembers: number;
  loans: number;
};

type StatusCorrection = {
  accountNumber: string;
  from: LoanStatus;
  to: LoanStatus;
};

async function main() {
  loadLocalEnvFile();

  const prisma = new PrismaClient();

  try {
    const runId = `ilend-sync-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const environment: NodeJS.ProcessEnv = { ...process.env, MIGRATION_RUN_ID: runId };

    console.log(`[sync-recent] Starting fresh sync run ${runId}`);

    const countsBefore = await getCounts(prisma);

    console.log("[sync-recent] Extracting current foundation roster...");
    const foundationExtract = await extractLegacy(environment);
    console.log(
      `[sync-recent] Foundation extraction finished: ${foundationExtract.manifest.artifacts.length} artifacts at ${foundationExtract.root}`,
    );

    console.log("[sync-recent] Extracting current loan history...");
    const loanExtract = await extractLegacyLoanHistory(environment);
    console.log(
      `[sync-recent] Loan history extraction finished: ${loanExtract.ownersProcessed} owners processed, ${loanExtract.loansExtracted} loan payloads extracted`,
    );
    if (loanExtract.errors.length > 0) {
      console.log(`[sync-recent] Loan history extraction reported ${loanExtract.errors.length} issue(s):`);
      for (const error of loanExtract.errors) console.log(`  - ${error}`);
    }

    const root = foundationExtract.root;
    const organization = await prisma.organization.findFirstOrThrow();
    const actor = await prisma.user.findFirstOrThrow({ where: { email: "testadmin@sovlend.com" } });
    const organizationName = process.env.MIGRATION_ORGANIZATION_NAME?.trim() || organization.name;

    console.log(`[sync-recent] Importing foundation archive into organization "${organizationName}"...`);
    const foundationImport = await importFoundation(prisma, root, organizationName);
    const countsAfterFoundation = await getCounts(prisma);
    console.log(
      `[sync-recent] Foundation import finished: run ${foundationImport.runId}, clients ${countsBefore.clients} -> ${countsAfterFoundation.clients}`,
    );

    console.log("[sync-recent] Importing groups, memberships, and brand-new loans from archive...");
    const archiveImport = await importArchiveGroupsAndLoans(prisma, root, organization.id, actor.id);
    const countsAfterArchiveImport = await getCounts(prisma);
    console.log(
      `[sync-recent] Archive loan import finished: groups ${countsAfterFoundation.groups} -> ${countsAfterArchiveImport.groups}, loans ${countsAfterFoundation.loans} -> ${countsAfterArchiveImport.loans}`,
    );
    if (archiveImport.loansSkipped.length > 0) {
      console.log(`[sync-recent] Archive importer skipped ${archiveImport.loansSkipped.length} loan(s):`);
      for (const loan of archiveImport.loansSkipped) console.log(`  - ${loan}`);
    }

    console.log("[sync-recent] Correcting status drift for already-imported legacy loans...");
    const statusCorrections = await correctLoanStatusDrift(prisma, root);
    const countsAfterStatusPass = await getCounts(prisma);

    const summaryLines = [
      "",
      "=== sync-recent summary ===",
      `Run ID: ${runId}`,
      `Archive root: ${root}`,
      "Extraction:",
      `- Foundation artifacts extracted: ${foundationExtract.manifest.artifacts.length}`,
      `- Owners processed successfully: ${loanExtract.ownersProcessed}`,
      `- Owners with extraction errors: ${loanExtract.errors.length}`,
      `- Loan payloads extracted: ${loanExtract.loansExtracted}`,
      "Imports:",
      `- Foundation import run: ${foundationImport.runId} (${foundationImport.artifacts} artifacts verified)`,
      `- Clients added by foundation import: ${countsAfterFoundation.clients - countsBefore.clients} (${countsBefore.clients} -> ${countsAfterFoundation.clients})`,
      `- Groups upserted by archive import: ${archiveImport.groupsImported}; groups added: ${countsAfterArchiveImport.groups - countsAfterFoundation.groups} (${countsAfterFoundation.groups} -> ${countsAfterArchiveImport.groups})`,
      `- Group memberships upserted by archive import: ${archiveImport.membersImported}; memberships added: ${countsAfterArchiveImport.groupMembers - countsAfterFoundation.groupMembers} (${countsAfterFoundation.groupMembers} -> ${countsAfterArchiveImport.groupMembers})`,
      `- New loans imported: ${archiveImport.loansImported} (${countsAfterFoundation.loans} -> ${countsAfterArchiveImport.loans})`,
      `- Loans skipped by archive import: ${archiveImport.loansSkipped.length}`,
      "Status drift:",
      `- Existing loans corrected: ${statusCorrections.length}`,
      `- Final counts: clients ${countsAfterStatusPass.clients}, groups ${countsAfterStatusPass.groups}, group memberships ${countsAfterStatusPass.groupMembers}, loans ${countsAfterStatusPass.loans}`,
    ];

    if (loanExtract.errors.length > 0) {
      summaryLines.push("- Extraction issues:");
      summaryLines.push(...loanExtract.errors.map((error) => `  • ${error}`));
    }

    if (archiveImport.loansSkipped.length > 0) {
      summaryLines.push("- Loan import skips:");
      summaryLines.push(...archiveImport.loansSkipped.map((loan) => `  • ${loan}`));
    }

    if (statusCorrections.length > 0) {
      summaryLines.push("- Status corrections:");
      summaryLines.push(...statusCorrections.map((item) => `  • ${item.accountNumber}: ${item.from} -> ${item.to}`));
    } else {
      summaryLines.push("- Status corrections: none");
    }

    console.log(summaryLines.join("\n"));
  } finally {
    await prisma.$disconnect();
  }
}

async function getCounts(prisma: PrismaClient): Promise<CountSnapshot> {
  const [clients, groups, groupMembers, loans] = await Promise.all([
    prisma.client.count(),
    prisma.group.count(),
    prisma.groupMember.count(),
    prisma.loan.count(),
  ]);

  return { clients, groups, groupMembers, loans };
}

async function correctLoanStatusDrift(prisma: PrismaClient, root: string): Promise<StatusCorrection[]> {
  const folder = path.join(root, "raw", "loans");
  let files: string[];

  try {
    files = (await readdir(folder)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }

  const localLoans = await prisma.loan.findMany({
    where: { accountNumber: { startsWith: "LEGACY-" } },
    select: { id: true, accountNumber: true, status: true, disbursedOn: true, maturesOn: true },
  });
  const localLoansByAccountNumber = new Map(localLoans.map((loan) => [loan.accountNumber, loan]));
  const corrections: StatusCorrection[] = [];

  for (const file of files) {
    const legacyLoanId = Number.parseInt(path.basename(file, ".json"), 10);
    if (!Number.isFinite(legacyLoanId)) continue;

    const accountNumber = `LEGACY-${legacyLoanId}`;
    const localLoan = localLoansByAccountNumber.get(accountNumber);
    if (!localLoan) continue;

    const payload = JSON.parse(await readFile(path.join(folder, file), "utf8")) as Record<string, unknown>;
    const status = mapLoanStatus(asRecord(payload.status));
    if (localLoan.status === status) continue;

    // IN_ARREARS is computed locally from real installment schedules by the
    // classifyLoanArrears worker job (src/modules/lending/application/classify-arrears.ts),
    // which is more accurate than Fineract's coarse status flags (mapLoanStatus above has
    // no concept of arrears at all). Never let this sync downgrade a locally-computed
    // IN_ARREARS loan to ACTIVE -- that previously corrupted 104 real arrears records.
    // Only apply terminal-state corrections (WRITTEN_OFF/OVERPAID/CLOSED) that Fineract
    // genuinely knows better than our own schedule classifier, and only ever move a loan
    // out of IN_ARREARS via one of those terminal states, never straight back to ACTIVE.
    if (localLoan.status === "IN_ARREARS" && status === "ACTIVE") continue;
    if (status !== "WRITTEN_OFF" && status !== "OVERPAID" && status !== "CLOSED" && localLoan.status !== "APPROVED") continue;

    const timeline = asRecord(payload.timeline);
    const disbursedOn = dateFromParts(timeline?.actualDisbursementDate);
    const maturesOn = dateFromParts(timeline?.expectedMaturityDate) ?? dateFromParts(timeline?.closedOnDate);
    const data: Prisma.LoanUpdateInput = { status };

    if (!localLoan.disbursedOn && disbursedOn) data.disbursedOn = disbursedOn;
    if (!localLoan.maturesOn && maturesOn) data.maturesOn = maturesOn;

    await prisma.loan.update({ where: { id: localLoan.id }, data });
    console.log(`Loan ${accountNumber}: ${localLoan.status} -> ${status}`);

    corrections.push({ accountNumber, from: localLoan.status, to: status });
    localLoansByAccountNumber.set(accountNumber, { ...localLoan, status, disbursedOn: localLoan.disbursedOn ?? disbursedOn, maturesOn: localLoan.maturesOn ?? maturesOn });
  }

  return corrections;
}

function mapLoanStatus(status: Record<string, unknown> | null | undefined): LoanStatus {
  if (status?.closedWrittenOff) return "WRITTEN_OFF";
  if (status?.overpaid) return "OVERPAID";
  if (status?.closed || status?.closedObligationsMet) return "CLOSED";
  if (status?.active) return "ACTIVE";
  return "APPROVED";
}

function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value;
  if (typeof year !== "number" || typeof month !== "number" || typeof day !== "number") return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function loadLocalEnvFile() {
  const processWithLoader = process as typeof process & { loadEnvFile?: (path?: string) => void };
  processWithLoader.loadEnvFile?.(".env");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

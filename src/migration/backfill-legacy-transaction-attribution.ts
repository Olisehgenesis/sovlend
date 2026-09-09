import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { deterministicUuid } from "./import-foundation";
import { asNumber, asRecord, asString, legacySavingsAccountIdFromAccountNumber } from "./legacy-savings";

type ArchiveRoot = Readonly<{
  root: string;
  extractedAt: string;
}>;

type SettlementAccountReference = Readonly<{
  id: string;
  name: string;
  provider: string | null;
  active: boolean;
}>;

type LegacyStaffRecord = Readonly<{
  id: number;
  firstname?: string | null;
  displayName?: string | null;
}>;

type LoanBackfillCandidate = Readonly<{
  id: string;
  externalReference: string | null;
  settlementAccountId: string | null;
}>;

type SavingsBackfillCandidate = Readonly<{
  id: string;
  externalReference: string | null;
  settlementAccountId: string | null;
  recordedByUserId: string | null;
  savingsAccountNumber: string;
}>;

type RawLoanLookupEntry = Readonly<{
  paymentTypeName: string | null;
}>;

type RawSavingsLookupEntry = Readonly<{
  paymentTypeName: string | null;
  submittedByUsername: string | null;
}>;

type FieldUpdate = Readonly<{
  id: string;
  value: string;
}>;

type CountMap = Map<string, number>;

type SettlementAccountMatchResult =
  | Readonly<{ kind: "matched"; settlementAccountId: string; settlementAccountName: string; matchStrategy: "exact" | "alias" }>
  | Readonly<{ kind: "missing-payment-type" }>
  | Readonly<{ kind: "unmatched"; paymentTypeName: string }>
  | Readonly<{ kind: "ambiguous"; paymentTypeName: string; matchingAccountNames: readonly string[] }>;

type SavingsRecorderMatchResult =
  | Readonly<{ kind: "matched"; userId: string; legacyStaffId: number; matchSource: "deleted-id" | "plain-name" }>
  | Readonly<{ kind: "missing-username" }>
  | Readonly<{ kind: "system-username"; username: string }>
  | Readonly<{ kind: "ambiguous-username"; username: string; matchingStaffIds: readonly number[] }>
  | Readonly<{ kind: "staff-id-not-found"; username: string; legacyStaffId: number }>
  | Readonly<{ kind: "staff-name-not-found"; username: string }>
  | Readonly<{ kind: "user-not-found"; username: string; legacyStaffId: number; userId: string }>;

export type LegacyTransactionBackfillPlanInput = Readonly<{
  organizationId: string;
  settlementAccounts: readonly SettlementAccountReference[];
  staffRecords: readonly LegacyStaffRecord[];
  existingUserIds: ReadonlySet<string>;
  loanTransactions: readonly LoanBackfillCandidate[];
  savingsTransactions: readonly SavingsBackfillCandidate[];
  rawLoanTransactionsByKey: ReadonlyMap<string, RawLoanLookupEntry>;
  rawSavingsTransactionsByKey: ReadonlyMap<string, RawSavingsLookupEntry>;
}>;

export type LegacyTransactionBackfillPlan = Readonly<{
  loanSettlementUpdates: readonly FieldUpdate[];
  savingsSettlementUpdates: readonly FieldUpdate[];
  savingsRecordedByUpdates: readonly FieldUpdate[];
  stats: {
    loanSettlement: {
      candidates: number;
      matched: number;
      missingRawTransaction: number;
      missingPaymentDetail: number;
      invalidExternalReference: number;
      unmatchedPaymentTypes: Readonly<Record<string, number>>;
      ambiguousPaymentTypes: Readonly<Record<string, number>>;
    };
    savingsSettlement: {
      candidates: number;
      matched: number;
      missingRawTransaction: number;
      missingPaymentDetail: number;
      invalidExternalReference: number;
      invalidSavingsAccountNumber: number;
      unmatchedPaymentTypes: Readonly<Record<string, number>>;
      ambiguousPaymentTypes: Readonly<Record<string, number>>;
    };
    savingsRecordedBy: {
      candidates: number;
      matched: number;
      matchedByDeletedId: number;
      matchedByPlainName: number;
      missingRawTransaction: number;
      invalidExternalReference: number;
      invalidSavingsAccountNumber: number;
      missingUsername: number;
      systemUsername: number;
      ambiguousUsername: number;
      staffIdNotFound: number;
      staffNameNotFound: number;
      userNotFound: number;
      ambiguousUsernames: Readonly<Record<string, number>>;
      systemUsernames: Readonly<Record<string, number>>;
      missingStaffIdUsernames: Readonly<Record<string, number>>;
      missingStaffNameUsernames: Readonly<Record<string, number>>;
      missingUserUsernames: Readonly<Record<string, number>>;
    };
  };
}>;

export type BackfillLegacyTransactionAttributionOptions = Readonly<{
  apply?: boolean;
  archiveBaseDir?: string;
  logger?: Pick<Console, "log" | "warn" | "error">;
}>;

export type BackfillLegacyTransactionAttributionResult = Readonly<{
  dryRun: boolean;
  archiveRoots: readonly string[];
  loanSettlementCandidates: number;
  loanSettlementUpdatesPlanned: number;
  loanSettlementUpdated: number;
  savingsSettlementCandidates: number;
  savingsSettlementUpdatesPlanned: number;
  savingsSettlementUpdated: number;
  savingsRecordedByCandidates: number;
  savingsRecordedByUpdatesPlanned: number;
  savingsRecordedByUpdated: number;
  loanRecordedByUnbackfillable: number;
  stats: LegacyTransactionBackfillPlan["stats"];
}>;

const LEGACY_LOAN_REF_PREFIX = "legacy:";
const DELETED_USERNAME_PATTERN = /^(\d+)_DELETED_(.+)$/i;
const SYSTEM_USERNAME_PATTERN = /(^|[^a-z])(api|system|bot|service)([^a-z]|$)/i;
const PAYMENT_TYPE_ALIASES = new Map<string, string>([
  ["cash payment", "cash"],
  ["cash in safe h 0", "cash"],
  ["cash in safe entebbe", "cash"],
  ["airtel line head office", "airtel money"],
  ["mtn line entebbe", "mtn momo"],
]);

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export function resolveSettlementAccountForPaymentType(
  paymentTypeName: string | null | undefined,
  settlementAccounts: readonly SettlementAccountReference[],
): SettlementAccountMatchResult {
  const trimmed = asString(paymentTypeName);
  if (!trimmed) return { kind: "missing-payment-type" };

  const directMatches = findMatchingSettlementAccounts(trimmed, settlementAccounts);
  if (directMatches.length === 1) {
    const match = directMatches[0];
    return { kind: "matched", settlementAccountId: match.id, settlementAccountName: match.name, matchStrategy: "exact" };
  }
  if (directMatches.length > 1) {
    return { kind: "ambiguous", paymentTypeName: trimmed, matchingAccountNames: directMatches.map((account) => account.name) };
  }

  const aliasTarget = PAYMENT_TYPE_ALIASES.get(normalizeComparableText(trimmed));
  if (!aliasTarget) return { kind: "unmatched", paymentTypeName: trimmed };

  const aliasMatches = findMatchingSettlementAccounts(aliasTarget, settlementAccounts);
  if (aliasMatches.length === 1) {
    const match = aliasMatches[0];
    return { kind: "matched", settlementAccountId: match.id, settlementAccountName: match.name, matchStrategy: "alias" };
  }
  if (aliasMatches.length > 1) {
    return { kind: "ambiguous", paymentTypeName: trimmed, matchingAccountNames: aliasMatches.map((account) => account.name) };
  }

  return { kind: "unmatched", paymentTypeName: trimmed };
}

export function resolveSavingsRecordedByUser(
  submittedByUsername: string | null | undefined,
  organizationId: string,
  staffRecords: readonly LegacyStaffRecord[],
  existingUserIds: ReadonlySet<string>,
): SavingsRecorderMatchResult {
  const trimmed = asString(submittedByUsername);
  if (!trimmed) return { kind: "missing-username" };
  if (isSystemUsername(trimmed)) return { kind: "system-username", username: trimmed };

  const deletedMatch = DELETED_USERNAME_PATTERN.exec(trimmed);
  if (deletedMatch) {
    const legacyStaffId = Number.parseInt(deletedMatch[1] ?? "", 10);
    if (!Number.isInteger(legacyStaffId) || legacyStaffId <= 0) {
      return { kind: "staff-id-not-found", username: trimmed, legacyStaffId };
    }
    const staff = staffRecords.find((entry) => entry.id === legacyStaffId);
    if (!staff) return { kind: "staff-id-not-found", username: trimmed, legacyStaffId };
    const userId = deterministicUuid(`staff:${organizationId}:${legacyStaffId}`);
    if (!existingUserIds.has(userId)) return { kind: "user-not-found", username: trimmed, legacyStaffId, userId };
    return { kind: "matched", userId, legacyStaffId, matchSource: "deleted-id" };
  }

  const normalized = normalizeComparableText(trimmed);
  const matches = new Map<number, LegacyStaffRecord>();
  for (const staff of staffRecords) {
    if (!staff.id) continue;
    const firstName = asString(staff.firstname);
    const displayName = asString(staff.displayName);
    if (
      (firstName && normalizeComparableText(firstName) === normalized) ||
      (displayName && normalizeComparableText(displayName) === normalized)
    ) {
      matches.set(staff.id, staff);
    }
  }

  if (matches.size === 0) return { kind: "staff-name-not-found", username: trimmed };
  if (matches.size > 1) return { kind: "ambiguous-username", username: trimmed, matchingStaffIds: [...matches.keys()].sort((a, b) => a - b) };

  const legacyStaffId = [...matches.keys()][0] ?? 0;
  const userId = deterministicUuid(`staff:${organizationId}:${legacyStaffId}`);
  if (!existingUserIds.has(userId)) return { kind: "user-not-found", username: trimmed, legacyStaffId, userId };
  return { kind: "matched", userId, legacyStaffId, matchSource: "plain-name" };
}

export function planLegacyTransactionBackfill(input: LegacyTransactionBackfillPlanInput): LegacyTransactionBackfillPlan {
  const loanSettlementUpdates: FieldUpdate[] = [];
  const savingsSettlementUpdates: FieldUpdate[] = [];
  const savingsRecordedByUpdates: FieldUpdate[] = [];

  const loanUnmatchedPaymentTypes = new Map<string, number>();
  const loanAmbiguousPaymentTypes = new Map<string, number>();
  const savingsUnmatchedPaymentTypes = new Map<string, number>();
  const savingsAmbiguousPaymentTypes = new Map<string, number>();
  const ambiguousUsernames = new Map<string, number>();
  const systemUsernames = new Map<string, number>();
  const missingStaffIdUsernames = new Map<string, number>();
  const missingStaffNameUsernames = new Map<string, number>();
  const missingUserUsernames = new Map<string, number>();

  let loanMissingRawTransaction = 0;
  let loanMissingPaymentDetail = 0;
  let loanInvalidExternalReference = 0;

  let savingsSettlementMissingRawTransaction = 0;
  let savingsSettlementMissingPaymentDetail = 0;
  let savingsSettlementInvalidExternalReference = 0;
  let savingsSettlementInvalidSavingsAccountNumber = 0;

  let savingsRecordedByMissingRawTransaction = 0;
  let savingsRecordedByInvalidExternalReference = 0;
  let savingsRecordedByInvalidSavingsAccountNumber = 0;
  let savingsRecordedByMissingUsername = 0;
  let savingsRecordedBySystemUsername = 0;
  let savingsRecordedByAmbiguousUsername = 0;
  let savingsRecordedByStaffIdNotFound = 0;
  let savingsRecordedByStaffNameNotFound = 0;
  let savingsRecordedByUserNotFound = 0;
  let matchedByDeletedId = 0;
  let matchedByPlainName = 0;

  for (const transaction of input.loanTransactions) {
    if (transaction.settlementAccountId) continue;

    const parsed = parseLegacyLoanExternalReference(transaction.externalReference);
    if (!parsed) {
      loanInvalidExternalReference += 1;
      continue;
    }

    const raw = input.rawLoanTransactionsByKey.get(loanLookupKey(parsed.loanId, parsed.legacyTransactionId));
    if (!raw) {
      loanMissingRawTransaction += 1;
      continue;
    }

    const resolution = resolveSettlementAccountForPaymentType(raw.paymentTypeName, input.settlementAccounts);
    if (resolution.kind === "matched") {
      loanSettlementUpdates.push({ id: transaction.id, value: resolution.settlementAccountId });
      continue;
    }
    if (resolution.kind === "missing-payment-type") {
      loanMissingPaymentDetail += 1;
      continue;
    }
    if (resolution.kind === "unmatched") {
      incrementCount(loanUnmatchedPaymentTypes, resolution.paymentTypeName);
      continue;
    }
    incrementCount(loanAmbiguousPaymentTypes, resolution.paymentTypeName);
  }

  for (const transaction of input.savingsTransactions) {
    const legacySavingsAccountId = legacySavingsAccountIdFromAccountNumber(transaction.savingsAccountNumber);
    if (legacySavingsAccountId === null) {
      if (!transaction.settlementAccountId) savingsSettlementInvalidSavingsAccountNumber += 1;
      if (!transaction.recordedByUserId) savingsRecordedByInvalidSavingsAccountNumber += 1;
      continue;
    }

    const legacyTransactionId = parseLegacySavingsExternalReference(transaction.externalReference);
    if (legacyTransactionId === null) {
      if (!transaction.settlementAccountId) savingsSettlementInvalidExternalReference += 1;
      if (!transaction.recordedByUserId) savingsRecordedByInvalidExternalReference += 1;
      continue;
    }

    const raw = input.rawSavingsTransactionsByKey.get(savingsLookupKey(legacySavingsAccountId, legacyTransactionId));

    if (!transaction.settlementAccountId) {
      if (!raw) {
        savingsSettlementMissingRawTransaction += 1;
      } else {
        const resolution = resolveSettlementAccountForPaymentType(raw.paymentTypeName, input.settlementAccounts);
        if (resolution.kind === "matched") {
          savingsSettlementUpdates.push({ id: transaction.id, value: resolution.settlementAccountId });
        } else if (resolution.kind === "missing-payment-type") {
          savingsSettlementMissingPaymentDetail += 1;
        } else if (resolution.kind === "unmatched") {
          incrementCount(savingsUnmatchedPaymentTypes, resolution.paymentTypeName);
        } else {
          incrementCount(savingsAmbiguousPaymentTypes, resolution.paymentTypeName);
        }
      }
    }

    if (!transaction.recordedByUserId) {
      if (!raw) {
        savingsRecordedByMissingRawTransaction += 1;
        continue;
      }

      const resolution = resolveSavingsRecordedByUser(raw.submittedByUsername, input.organizationId, input.staffRecords, input.existingUserIds);
      if (resolution.kind === "matched") {
        savingsRecordedByUpdates.push({ id: transaction.id, value: resolution.userId });
        if (resolution.matchSource === "deleted-id") matchedByDeletedId += 1;
        else matchedByPlainName += 1;
        continue;
      }
      if (resolution.kind === "missing-username") {
        savingsRecordedByMissingUsername += 1;
        continue;
      }
      if (resolution.kind === "system-username") {
        savingsRecordedBySystemUsername += 1;
        incrementCount(systemUsernames, resolution.username);
        continue;
      }
      if (resolution.kind === "ambiguous-username") {
        savingsRecordedByAmbiguousUsername += 1;
        incrementCount(ambiguousUsernames, resolution.username);
        continue;
      }
      if (resolution.kind === "staff-id-not-found") {
        savingsRecordedByStaffIdNotFound += 1;
        incrementCount(missingStaffIdUsernames, resolution.username);
        continue;
      }
      if (resolution.kind === "staff-name-not-found") {
        savingsRecordedByStaffNameNotFound += 1;
        incrementCount(missingStaffNameUsernames, resolution.username);
        continue;
      }
      savingsRecordedByUserNotFound += 1;
      incrementCount(missingUserUsernames, resolution.username);
    }
  }

  return {
    loanSettlementUpdates,
    savingsSettlementUpdates,
    savingsRecordedByUpdates,
    stats: {
      loanSettlement: {
        candidates: input.loanTransactions.filter((transaction) => !transaction.settlementAccountId).length,
        matched: loanSettlementUpdates.length,
        missingRawTransaction: loanMissingRawTransaction,
        missingPaymentDetail: loanMissingPaymentDetail,
        invalidExternalReference: loanInvalidExternalReference,
        unmatchedPaymentTypes: Object.fromEntries([...loanUnmatchedPaymentTypes.entries()].sort((left, right) => right[1] - left[1])),
        ambiguousPaymentTypes: Object.fromEntries([...loanAmbiguousPaymentTypes.entries()].sort((left, right) => right[1] - left[1])),
      },
      savingsSettlement: {
        candidates: input.savingsTransactions.filter((transaction) => !transaction.settlementAccountId).length,
        matched: savingsSettlementUpdates.length,
        missingRawTransaction: savingsSettlementMissingRawTransaction,
        missingPaymentDetail: savingsSettlementMissingPaymentDetail,
        invalidExternalReference: savingsSettlementInvalidExternalReference,
        invalidSavingsAccountNumber: savingsSettlementInvalidSavingsAccountNumber,
        unmatchedPaymentTypes: Object.fromEntries([...savingsUnmatchedPaymentTypes.entries()].sort((left, right) => right[1] - left[1])),
        ambiguousPaymentTypes: Object.fromEntries([...savingsAmbiguousPaymentTypes.entries()].sort((left, right) => right[1] - left[1])),
      },
      savingsRecordedBy: {
        candidates: input.savingsTransactions.filter((transaction) => !transaction.recordedByUserId).length,
        matched: savingsRecordedByUpdates.length,
        matchedByDeletedId,
        matchedByPlainName,
        missingRawTransaction: savingsRecordedByMissingRawTransaction,
        invalidExternalReference: savingsRecordedByInvalidExternalReference,
        invalidSavingsAccountNumber: savingsRecordedByInvalidSavingsAccountNumber,
        missingUsername: savingsRecordedByMissingUsername,
        systemUsername: savingsRecordedBySystemUsername,
        ambiguousUsername: savingsRecordedByAmbiguousUsername,
        staffIdNotFound: savingsRecordedByStaffIdNotFound,
        staffNameNotFound: savingsRecordedByStaffNameNotFound,
        userNotFound: savingsRecordedByUserNotFound,
        ambiguousUsernames: Object.fromEntries([...ambiguousUsernames.entries()].sort((left, right) => right[1] - left[1])),
        systemUsernames: Object.fromEntries([...systemUsernames.entries()].sort((left, right) => right[1] - left[1])),
        missingStaffIdUsernames: Object.fromEntries([...missingStaffIdUsernames.entries()].sort((left, right) => right[1] - left[1])),
        missingStaffNameUsernames: Object.fromEntries([...missingStaffNameUsernames.entries()].sort((left, right) => right[1] - left[1])),
        missingUserUsernames: Object.fromEntries([...missingUserUsernames.entries()].sort((left, right) => right[1] - left[1])),
      },
    },
  };
}

export async function backfillLegacyTransactionAttribution(
  prismaClient: PrismaClient,
  options: BackfillLegacyTransactionAttributionOptions = {},
): Promise<BackfillLegacyTransactionAttributionResult> {
  const logger = options.logger ?? console;
  const dryRun = options.apply !== true;
  const archiveRoots = await discoverArchiveRoots(options.archiveBaseDir ?? ".migration-data");
  if (archiveRoots.length === 0) throw new Error("No migration archives with manifest.json files were found");

  const organization = await prismaClient.organization.findFirstOrThrow({ select: { id: true } });
  const organizationId = organization.id;

  const [loanTransactions, savingsTransactions, settlementAccounts, loanRecordedByUnbackfillable] = await Promise.all([
    prismaClient.loanTransaction.findMany({
      where: { externalReference: { startsWith: LEGACY_LOAN_REF_PREFIX }, settlementAccountId: null },
      select: { id: true, externalReference: true, settlementAccountId: true },
      orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
    }),
    prismaClient.savingsTransaction.findMany({
      where: {
        externalReference: { not: null },
        OR: [{ settlementAccountId: null }, { recordedByUserId: null }],
      },
      select: {
        id: true,
        externalReference: true,
        settlementAccountId: true,
        recordedByUserId: true,
        savingsAccount: { select: { accountNumber: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prismaClient.settlementAccount.findMany({
      where: { organizationId, active: true },
      select: { id: true, name: true, provider: true, active: true },
      orderBy: { name: "asc" },
    }),
    prismaClient.loanTransaction.count({ where: { externalReference: { startsWith: LEGACY_LOAN_REF_PREFIX }, recordedByUserId: null } }),
  ]);

  const mappedSavingsTransactions: SavingsBackfillCandidate[] = savingsTransactions.map((transaction) => ({
    id: transaction.id,
    externalReference: transaction.externalReference,
    settlementAccountId: transaction.settlementAccountId,
    recordedByUserId: transaction.recordedByUserId,
    savingsAccountNumber: transaction.savingsAccount.accountNumber,
  }));
  const legacySavingsTransactions = mappedSavingsTransactions.filter((transaction) => isLegacyImportedSavingsTransaction(transaction));

  const distinctLoanIds = [...new Set(loanTransactions.map((transaction) => parseLegacyLoanExternalReference(transaction.externalReference)?.loanId).filter((value): value is number => value != null))];
  const distinctSavingsAccountIds = [
    ...new Set(
      legacySavingsTransactions
        .map((transaction) => legacySavingsAccountIdFromAccountNumber(transaction.savingsAccountNumber))
        .filter((value): value is number => value != null),
    ),
  ];

  const [rawLoanTransactionsByKey, rawSavingsTransactionsByKey, staffRecords] = await Promise.all([
    loadRawLoanTransactionsByKey(archiveRoots, distinctLoanIds),
    loadRawSavingsTransactionsByKey(archiveRoots, distinctSavingsAccountIds),
    loadLegacyStaffRecords(archiveRoots),
  ]);

  const expectedUserIds = staffRecords.map((staff) => deterministicUuid(`staff:${organizationId}:${staff.id}`));
  const existingUserIds = new Set(
    (
      await prismaClient.user.findMany({
        where: expectedUserIds.length > 0 ? { id: { in: expectedUserIds } } : { id: { in: [] } },
        select: { id: true },
      })
    ).map((user) => user.id),
  );

  const plan = planLegacyTransactionBackfill({
    organizationId,
    settlementAccounts: settlementAccounts.filter((account) => !/smoke test/i.test(account.name)),
    staffRecords,
    existingUserIds,
    loanTransactions,
    savingsTransactions: legacySavingsTransactions,
    rawLoanTransactionsByKey,
    rawSavingsTransactionsByKey,
  });

  let loanSettlementUpdated = 0;
  let savingsSettlementUpdated = 0;
  let savingsRecordedByUpdated = 0;

  if (!dryRun) {
    const disableLoanTrigger = plan.loanSettlementUpdates.length > 0;
    const disableSavingsTrigger = plan.savingsSettlementUpdates.length > 0 || plan.savingsRecordedByUpdates.length > 0;
    const applied = await prismaClient.$transaction(
      async (transaction) => {
        if (disableLoanTrigger) {
          await transaction.$executeRawUnsafe('ALTER TABLE "LoanTransaction" DISABLE TRIGGER loan_transaction_append_only');
        }
        if (disableSavingsTrigger) {
          await transaction.$executeRawUnsafe('ALTER TABLE "SavingsTransaction" DISABLE TRIGGER savings_transaction_append_only');
        }

        try {
          return {
            loanSettlementUpdated: await applyFieldUpdates(transaction, "loanTransaction", "settlementAccountId", plan.loanSettlementUpdates),
            savingsSettlementUpdated: await applyFieldUpdates(transaction, "savingsTransaction", "settlementAccountId", plan.savingsSettlementUpdates),
            savingsRecordedByUpdated: await applyFieldUpdates(transaction, "savingsTransaction", "recordedByUserId", plan.savingsRecordedByUpdates),
          };
        } finally {
          if (disableSavingsTrigger) {
            await transaction.$executeRawUnsafe('ALTER TABLE "SavingsTransaction" ENABLE TRIGGER savings_transaction_append_only');
          }
          if (disableLoanTrigger) {
            await transaction.$executeRawUnsafe('ALTER TABLE "LoanTransaction" ENABLE TRIGGER loan_transaction_append_only');
          }
        }
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    loanSettlementUpdated = applied.loanSettlementUpdated;
    savingsSettlementUpdated = applied.savingsSettlementUpdated;
    savingsRecordedByUpdated = applied.savingsRecordedByUpdated;
  }

  logger.log(`${dryRun ? "Dry-run" : "Apply"} complete for legacy transaction attribution backfill.`);
  logger.log(`Archive roots: ${archiveRoots.map((archive) => archive.root).join(", ")}`);
  logger.log(`Loan settlement candidates: ${plan.stats.loanSettlement.candidates}`);
  logger.log(`Loan settlement ${dryRun ? "to update" : "updated"}: ${dryRun ? plan.loanSettlementUpdates.length : loanSettlementUpdated}`);
  logger.log(`Loan settlement skipped for missing payment detail: ${plan.stats.loanSettlement.missingPaymentDetail}`);
  logger.log(`Savings settlement candidates: ${plan.stats.savingsSettlement.candidates}`);
  logger.log(`Savings settlement ${dryRun ? "to update" : "updated"}: ${dryRun ? plan.savingsSettlementUpdates.length : savingsSettlementUpdated}`);
  logger.log(`Savings settlement skipped for missing payment detail: ${plan.stats.savingsSettlement.missingPaymentDetail}`);
  logger.log(`Savings recordedBy candidates: ${plan.stats.savingsRecordedBy.candidates}`);
  logger.log(`Savings recordedBy ${dryRun ? "to update" : "updated"}: ${dryRun ? plan.savingsRecordedByUpdates.length : savingsRecordedByUpdated}`);
  logger.log(`Savings recordedBy skipped: missing username=${plan.stats.savingsRecordedBy.missingUsername}, system username=${plan.stats.savingsRecordedBy.systemUsername}, ambiguous=${plan.stats.savingsRecordedBy.ambiguousUsername}, staff id missing=${plan.stats.savingsRecordedBy.staffIdNotFound}, staff name missing=${plan.stats.savingsRecordedBy.staffNameNotFound}, local user missing=${plan.stats.savingsRecordedBy.userNotFound}`);
  logger.log(`Loan recordedBy left untouched/unbackfillable from this archive: ${loanRecordedByUnbackfillable}`);

  logCountMap(logger, "Loan unmatched payment types", plan.stats.loanSettlement.unmatchedPaymentTypes);
  logCountMap(logger, "Savings unmatched payment types", plan.stats.savingsSettlement.unmatchedPaymentTypes);
  logCountMap(logger, "Savings ambiguous usernames", plan.stats.savingsRecordedBy.ambiguousUsernames);
  logCountMap(logger, "Savings system usernames", plan.stats.savingsRecordedBy.systemUsernames);
  logCountMap(logger, "Savings usernames with missing legacy staff id", plan.stats.savingsRecordedBy.missingStaffIdUsernames);
  logCountMap(logger, "Savings usernames with no legacy staff name match", plan.stats.savingsRecordedBy.missingStaffNameUsernames);
  logCountMap(logger, "Savings usernames with missing local user row", plan.stats.savingsRecordedBy.missingUserUsernames);

  return {
    dryRun,
    archiveRoots: archiveRoots.map((archive) => archive.root),
    loanSettlementCandidates: plan.stats.loanSettlement.candidates,
    loanSettlementUpdatesPlanned: plan.loanSettlementUpdates.length,
    loanSettlementUpdated,
    savingsSettlementCandidates: plan.stats.savingsSettlement.candidates,
    savingsSettlementUpdatesPlanned: plan.savingsSettlementUpdates.length,
    savingsSettlementUpdated,
    savingsRecordedByCandidates: plan.stats.savingsRecordedBy.candidates,
    savingsRecordedByUpdatesPlanned: plan.savingsRecordedByUpdates.length,
    savingsRecordedByUpdated,
    loanRecordedByUnbackfillable: loanRecordedByUnbackfillable,
    stats: plan.stats,
  };
}

async function applyFieldUpdates(
  prismaClient: DatabaseClient,
  model: "loanTransaction" | "savingsTransaction",
  field: "settlementAccountId" | "recordedByUserId",
  updates: readonly FieldUpdate[],
) {
  const grouped = new Map<string, string[]>();
  for (const update of updates) {
    const existing = grouped.get(update.value);
    if (existing) existing.push(update.id);
    else grouped.set(update.value, [update.id]);
  }

  let updated = 0;
  for (const [value, ids] of grouped.entries()) {
    if (model === "loanTransaction" && field === "settlementAccountId") {
      const result = await prismaClient.loanTransaction.updateMany({
        where: { id: { in: ids }, settlementAccountId: null },
        data: { settlementAccountId: value },
      });
      updated += result.count;
      continue;
    }
    if (field === "settlementAccountId") {
      const result = await prismaClient.savingsTransaction.updateMany({
        where: { id: { in: ids }, settlementAccountId: null },
        data: { settlementAccountId: value },
      });
      updated += result.count;
      continue;
    }
    const result = await prismaClient.savingsTransaction.updateMany({
      where: { id: { in: ids }, recordedByUserId: null },
      data: { recordedByUserId: value },
    });
    updated += result.count;
  }

  return updated;
}

function findMatchingSettlementAccounts(paymentTypeName: string, settlementAccounts: readonly SettlementAccountReference[]) {
  const normalized = normalizeComparableText(paymentTypeName);
  return settlementAccounts.filter((account) => {
    const name = normalizeComparableText(account.name);
    const provider = account.provider ? normalizeComparableText(account.provider) : null;
    return name === normalized || provider === normalized;
  });
}

function normalizeComparableText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isSystemUsername(username: string) {
  const normalized = normalizeComparableText(username);
  return normalized === "paybillapi" || SYSTEM_USERNAME_PATTERN.test(normalized);
}

function isLegacyImportedSavingsTransaction(transaction: SavingsBackfillCandidate) {
  return (
    legacySavingsAccountIdFromAccountNumber(transaction.savingsAccountNumber) !== null &&
    parseLegacySavingsExternalReference(transaction.externalReference) !== null
  );
}

function incrementCount(target: CountMap, key: string) {
  target.set(key, (target.get(key) ?? 0) + 1);
}

function parseLegacyLoanExternalReference(externalReference: string | null) {
  if (!externalReference?.startsWith(LEGACY_LOAN_REF_PREFIX)) return null;
  const parts = externalReference.split(":");
  if (parts.length < 3) return null;
  const loanId = Number(parts[1]);
  const legacyTransactionId = Number(parts[2]);
  if (!Number.isInteger(loanId) || loanId <= 0 || !Number.isInteger(legacyTransactionId) || legacyTransactionId <= 0) return null;
  return { loanId, legacyTransactionId };
}

function parseLegacySavingsExternalReference(externalReference: string | null) {
  const value = Number(externalReference);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function loanLookupKey(loanId: number, legacyTransactionId: number) {
  return `${loanId}:${legacyTransactionId}`;
}

export function savingsLookupKey(legacySavingsAccountId: number, legacyTransactionId: number) {
  return `${legacySavingsAccountId}:${legacyTransactionId}`;
}

async function discoverArchiveRoots(baseDir: string): Promise<ArchiveRoot[]> {
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return [];
  }

  const roots: ArchiveRoot[] = [];
  for (const entry of entries.sort()) {
    const root = path.join(baseDir, entry);
    try {
      const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as { extractedAt?: string };
      await access(path.join(root, "raw"));
      roots.push({ root, extractedAt: manifest.extractedAt ?? "" });
    } catch {
      continue;
    }
  }

  return roots.sort((left, right) => right.extractedAt.localeCompare(left.extractedAt));
}

async function loadRawLoanTransactionsByKey(archiveRoots: readonly ArchiveRoot[], legacyLoanIds: readonly number[]) {
  const lookup = new Map<string, RawLoanLookupEntry>();
  for (const legacyLoanId of legacyLoanIds) {
    const payload = await readArchiveEntityFile(archiveRoots, "loans", legacyLoanId);
    if (!payload) continue;
    for (const transaction of asTransactions(asRecord(payload)?.transactions)) {
      const legacyTransactionId = asNumber(transaction.id);
      if (legacyTransactionId === null) continue;
      lookup.set(loanLookupKey(legacyLoanId, legacyTransactionId), {
        paymentTypeName: asString(asRecord(asRecord(transaction.paymentDetailData)?.paymentType)?.name),
      });
    }
  }
  return lookup;
}

async function loadRawSavingsTransactionsByKey(archiveRoots: readonly ArchiveRoot[], legacySavingsAccountIds: readonly number[]) {
  const lookup = new Map<string, RawSavingsLookupEntry>();
  for (const legacySavingsAccountId of legacySavingsAccountIds) {
    const payload = await readArchiveEntityFile(archiveRoots, "savings-accounts", legacySavingsAccountId);
    if (!payload) continue;
    for (const transaction of asTransactions(asRecord(payload)?.transactions)) {
      const legacyTransactionId = asNumber(transaction.id);
      if (legacyTransactionId === null) continue;
      lookup.set(savingsLookupKey(legacySavingsAccountId, legacyTransactionId), {
        paymentTypeName: asString(asRecord(asRecord(transaction.paymentDetailData)?.paymentType)?.name),
        submittedByUsername: asString(transaction.submittedByUsername),
      });
    }
  }
  return lookup;
}

async function loadLegacyStaffRecords(archiveRoots: readonly ArchiveRoot[]) {
  const records = new Map<number, LegacyStaffRecord>();

  for (const archive of archiveRoots) {
    const directory = path.join(archive.root, "raw", "staff");
    let files: string[];
    try {
      files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    } catch {
      continue;
    }

    for (const file of files) {
      const payload = JSON.parse(await readFile(path.join(directory, file), "utf8")) as unknown;
      if (!Array.isArray(payload)) continue;
      for (const entry of payload) {
        const record = asRecord(entry);
        const id = asNumber(record?.id);
        if (id === null || records.has(id)) continue;
        records.set(id, {
          id,
          firstname: asString(record?.firstname),
          displayName: asString(record?.displayName),
        });
      }
    }
  }

  return [...records.values()].sort((left, right) => left.id - right.id);
}

async function readArchiveEntityFile(archiveRoots: readonly ArchiveRoot[], entity: string, legacyId: number) {
  for (const archive of archiveRoots) {
    for (const fileName of [`${legacyId}.json`, `${String(legacyId).padStart(6, "0")}.json`]) {
      const filePath = path.join(archive.root, "raw", entity, fileName);
      try {
        return JSON.parse(await readFile(filePath, "utf8")) as unknown;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function asTransactions(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null) : [];
}

function logCountMap(logger: Pick<Console, "log">, label: string, counts: Readonly<Record<string, number>>) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return;
  logger.log(`${label}:`);
  for (const [key, count] of entries) logger.log(`  ${count} × ${key}`);
}

function parseOptions(argv: readonly string[]): BackfillLegacyTransactionAttributionOptions {
  const options: BackfillLegacyTransactionAttributionOptions = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      (options as { apply: boolean }).apply = true;
      continue;
    }
    if (argument === "--archive-base-dir") {
      (options as { archiveBaseDir?: string }).archiveBaseDir = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

async function main() {
  process.loadEnvFile?.(".env");
  const result = await backfillLegacyTransactionAttribution(prisma, parseOptions(process.argv.slice(2)));
  console.log(
    `Summary: loan settlement ${result.dryRun ? "planned" : "updated"}=${result.dryRun ? result.loanSettlementUpdatesPlanned : result.loanSettlementUpdated}, savings settlement ${result.dryRun ? "planned" : "updated"}=${result.dryRun ? result.savingsSettlementUpdatesPlanned : result.savingsSettlementUpdated}, savings recordedBy ${result.dryRun ? "planned" : "updated"}=${result.dryRun ? result.savingsRecordedByUpdatesPlanned : result.savingsRecordedByUpdated}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main()
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

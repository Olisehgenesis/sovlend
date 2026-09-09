import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import { deterministicUuid } from "./import-foundation";
import { normalizeLegacyLoanTransactionType } from "./backfill-ledger-bootstrap";
import { toMinor } from "./money";

/**
 * Imports groups, group membership, and full loan history (schedule + transactions)
 * directly from the already-extracted, checksum-verified archive produced by
 * `extract.ts` / `extract-loans.ts` -- no live calls to the legacy system are made
 * here. This complements `importFoundation`, which only imports the roster
 * (offices/currencies/clients/loanProducts/glaccounts).
 *
 * Client/office ids are recomputed with the same deterministic UUID scheme
 * `importFoundation` used, so no id-map lookups are required -- this keeps the
 * import idempotent and safe to re-run.
 */
export async function importArchiveGroupsAndLoans(
  prisma: PrismaClient,
  root: string,
  organizationId: string,
  actorUserId: string,
  options: Readonly<{ syncExistingLoans?: boolean }> = {},
) {
  const groupsImported = await importGroups(prisma, root, organizationId);
  const membersImported = await importGroupMembers(prisma, root, organizationId);
  const loanResult = await importLoans(prisma, root, organizationId, actorUserId, options);
  return { groupsImported, membersImported, ...loanResult };
}

async function importGroups(prisma: PrismaClient, root: string, organizationId: string): Promise<number> {
  const file = path.join(root, "raw/groups/000000.json");
  let groups: Array<Record<string, unknown>>;
  try {
    groups = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return 0;
  }

  let imported = 0;
  for (const group of groups) {
    const legacyGroupId = Number(group.id);
    const id = deterministicUuid(`group:${organizationId}:${legacyGroupId}`);
    const officeId = deterministicUuid(`office:${organizationId}:${Number(group.officeId)}`);
    const status = (group.status as Record<string, unknown> | undefined)?.code === "clientStatusType.active" ? "ACTIVE" : "PENDING";
    const timeline = (group.timeline ?? {}) as Record<string, unknown>;
    const values = {
      organizationId,
      officeId,
      accountNumber: String(group.accountNo ?? String(legacyGroupId)),
      externalId: `legacy:${legacyGroupId}`,
      name: String(group.name ?? `Group ${legacyGroupId}`),
      status: status as "ACTIVE" | "PENDING",
      submittedOn: dateFromParts(timeline.submittedOnDate),
      activatedOn: dateFromParts(group.activationDate),
    };
    await prisma.group.upsert({ where: { id }, create: { id, ...values }, update: values });
    imported += 1;
  }
  return imported;
}

async function importGroupMembers(prisma: PrismaClient, root: string, organizationId: string): Promise<number> {
  const folder = path.join(root, "raw/group-detail");
  let files: string[];
  try {
    files = (await readdir(folder)).filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return 0;
  }

  let imported = 0;
  for (const file of files) {
    const detail = JSON.parse(await readFile(path.join(folder, file), "utf8")) as Record<string, unknown>;
    const legacyGroupId = Number(detail.id);
    const groupId = deterministicUuid(`group:${organizationId}:${legacyGroupId}`);
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) continue;

    const members = (detail.clientMembers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const member of members) {
      const legacyClientId = Number(member.id);
      const clientId = deterministicUuid(`client:${organizationId}:${legacyClientId}`);
      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client) continue;
      await prisma.groupMember.upsert({
        where: { groupId_clientId: { groupId, clientId } },
        create: { groupId, clientId, joinedOn: dateFromParts(member.activationDate) ?? new Date() },
        update: {},
      });
      imported += 1;
    }
  }
  return imported;
}

async function importLoans(
  prisma: PrismaClient,
  root: string,
  organizationId: string,
  actorUserId: string,
  options: Readonly<{ syncExistingLoans?: boolean }>,
) {
  const folder = path.join(root, "raw/loans");
  let files: string[];
  try {
    files = (await readdir(folder)).filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return { loansImported: 0, loansSkipped: [] as string[] };
  }

  let loansImported = 0;
  let loansSynced = 0;
  let transactionsImported = 0;
  let installmentsUpdated = 0;
  const loansSkipped: string[] = [];

  for (const file of files) {
    const loan = JSON.parse(await readFile(path.join(folder, file), "utf8")) as Record<string, unknown>;
    const legacyLoanId = Number(loan.id);
    const accountNumber = `LEGACY-${legacyLoanId}`;

    const alreadyImported = await prisma.loan.findFirst({ where: { accountNumber }, select: { id: true } });
    if (alreadyImported) {
      if (!options.syncExistingLoans) continue;
      try {
        const syncResult = await syncExistingLoanHistory(prisma, alreadyImported.id, loan);
        loansSynced += 1;
        transactionsImported += syncResult.transactionsImported;
        installmentsUpdated += syncResult.installmentsUpdated;
      } catch (error) {
        loansSkipped.push(`Loan #${legacyLoanId}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      continue;
    }

    try {
      const legacyClientId = loan.clientId != null ? Number(loan.clientId) : null;
      const legacyOfficeId = loan.clientOfficeId != null ? Number(loan.clientOfficeId) : null;
      if (legacyClientId === null || legacyOfficeId === null) {
        loansSkipped.push(`Loan #${legacyLoanId}: missing clientId/clientOfficeId`);
        continue;
      }
      const clientId = deterministicUuid(`client:${organizationId}:${legacyClientId}`);
      const officeId = deterministicUuid(`office:${organizationId}:${legacyOfficeId}`);
      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client) {
        loansSkipped.push(`Loan #${legacyLoanId}: client #${legacyClientId} not imported`);
        continue;
      }

      const product = await prisma.loanProduct.findFirst({ where: { organizationId, name: String(loan.loanProductName ?? "") } });
      if (!product) {
        loansSkipped.push(`Loan #${legacyLoanId}: no product named "${loan.loanProductName}" configured`);
        continue;
      }

      const currency = (loan.currency as Record<string, unknown>).code as string;
      const exponent = Number((loan.currency as Record<string, unknown>).decimalPlaces ?? 2);
      const status = loan.status as Record<string, unknown>;
      const timeline = (loan.timeline ?? {}) as Record<string, unknown>;
      const summary = (loan.summary ?? {}) as Record<string, unknown>;
      const schedule = (loan.repaymentSchedule as Record<string, unknown> | undefined)?.periods as Array<Record<string, unknown>> | undefined;
      const transactions = (loan.transactions as Array<Record<string, unknown>>) ?? [];
      const principalMinor = toMinor(Number(loan.principal ?? 0), exponent);
      const correlationId = randomUUID();
      const metadata = { legacyLoanId };

      await prisma.$transaction(async (transaction) => {
        const application = await transaction.loanApplication.create({
          data: {
            clientId,
            productId: product.id,
            officeId,
            proposedPrincipalMinor: principalMinor,
            approvedPrincipalMinor: principalMinor,
            status: "DISBURSED",
            purpose: `Imported from legacy iLend loan #${legacyLoanId}`,
            submittedAt: dateFromParts(timeline.submittedOnDate),
            approvedAt: dateFromParts(timeline.approvedOnDate),
          },
        });

        const createdLoan = await transaction.loan.create({
          data: {
            applicationId: application.id,
            clientId,
            productId: product.id,
            officeId,
            accountNumber,
            denominationCurrency: currency,
            principalMinor,
            status: mapLoanStatus(status),
            disbursedOn: dateFromParts(timeline.actualDisbursementDate),
            maturesOn: dateFromParts(timeline.expectedMaturityDate) ?? dateFromParts(timeline.closedOnDate),
            principalWrittenOffMinor: toMinor(Number(summary.principalWrittenOff ?? 0), exponent),
            interestWrittenOffMinor: toMinor(Number(summary.interestWrittenOff ?? 0), exponent),
            feesWrittenOffMinor: toMinor(Number(summary.feeChargesWrittenOff ?? 0), exponent),
            penaltiesWrittenOffMinor: toMinor(Number(summary.penaltyChargesWrittenOff ?? 0), exponent),
          },
        });

        for (const period of schedule ?? []) {
          const installmentNumber = Number(period.period ?? 0);
          if (installmentNumber <= 0) continue;
          await transaction.loanInstallment.create({
            data: {
              loanId: createdLoan.id,
              installmentNumber,
              dueOn: dateFromParts(period.dueDate) ?? new Date(),
              principalDueMinor: toMinor(Number(period.principalOriginalDue ?? 0), exponent),
              interestDueMinor: toMinor(Number(period.interestOriginalDue ?? 0), exponent),
              feesDueMinor: toMinor(Number(period.feeChargesDue ?? 0), exponent),
              penaltiesDueMinor: toMinor(Number(period.penaltyChargesDue ?? 0), exponent),
              principalPaidMinor: toMinor(Number(period.principalPaid ?? 0), exponent),
              interestPaidMinor: toMinor(Number(period.interestPaid ?? 0), exponent),
              feesPaidMinor: toMinor(Number(period.feeChargesPaid ?? 0), exponent),
              penaltiesPaidMinor: toMinor(Number(period.penaltyChargesPaid ?? 0), exponent),
              principalWaivedMinor: toMinor(Number(period.principalWaived ?? 0), exponent),
              interestWaivedMinor: toMinor(Number(period.interestWaived ?? 0), exponent),
              feesWaivedMinor: toMinor(Number(period.feeChargesWaived ?? 0), exponent),
              penaltiesWaivedMinor: toMinor(Number(period.penaltyChargesWaived ?? 0), exponent),
            },
          });
        }

        const createdTransactionIds = new Map<unknown, string>();
        for (const txn of transactions) {
          const amountMinor = toMinor(Number(txn.amount ?? 0), exponent);
          const created = await transaction.loanTransaction.create({
            data: {
              loanId: createdLoan.id,
              transactionType: normalizeLegacyLoanTransactionType(String((txn.type as Record<string, unknown> | undefined)?.code ?? "unknown")),
              businessDate: dateFromParts(txn.date) ?? new Date(),
              settlementCurrency: currency,
              settlementChannel: "CASH",
              settlementAmountMinor: amountMinor,
              denominationAmountMinor: amountMinor,
              externalReference: `legacy:${legacyLoanId}:${txn.id}`,
              idempotencyKey: `legacy-loan-${legacyLoanId}-txn-${txn.id}`,
            },
          });
          createdTransactionIds.set(txn.id, created.id);
        }

        // Fineract flags transactions it has itself reversed with `manuallyReversed`. Link
        // those to a synthetic reversal record so `reversedById` filters exclude them from
        // totals, matching iLend's own already-netted "Total Paid"/summary figures.
        for (const txn of transactions) {
          if (!txn.manuallyReversed) continue;
          const originalId = createdTransactionIds.get(txn.id);
          if (!originalId) continue;
          const amountMinor = toMinor(Number(txn.amount ?? 0), exponent);
          const originalType = String((txn.type as Record<string, unknown> | undefined)?.code ?? "unknown");
          const reversal = await transaction.loanTransaction.create({
            data: {
              loanId: createdLoan.id,
              transactionType: normalizeLegacyLoanTransactionType(`${originalType}.reversal`),
              businessDate: dateFromParts(txn.date) ?? new Date(),
              settlementCurrency: currency,
              settlementChannel: "CASH",
              settlementAmountMinor: amountMinor,
              denominationAmountMinor: amountMinor,
              externalReference: `legacy:${legacyLoanId}:${txn.id}:reversal`,
              idempotencyKey: `legacy-loan-${legacyLoanId}-txn-${txn.id}-reversal`,
            },
          });
          await transaction.loanTransaction.update({ where: { id: originalId }, data: { reversedById: reversal.id } });
        }

        await transaction.auditEvent.create({
          data: {
            actorId: actorUserId,
            action: "loan.imported",
            entityType: "Loan",
            entityId: createdLoan.id,
            correlationId,
            metadata,
            eventHash: createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.imported", metadata })).digest("hex"),
          },
        });
      });

      loansImported += 1;
    } catch (error) {
      loansSkipped.push(`Loan #${legacyLoanId}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return { loansImported, loansSynced, transactionsImported, installmentsUpdated, loansSkipped };
}

function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value as number[];
  return new Date(Date.UTC(year, month - 1, day));
}

function mapLoanStatus(status: Record<string, unknown>): "APPROVED" | "ACTIVE" | "IN_ARREARS" | "OVERPAID" | "WRITTEN_OFF" | "CLOSED" {
  if (status.closedWrittenOff) return "WRITTEN_OFF";
  if (status.overpaid) return "OVERPAID";
  if (status.closed || status.closedObligationsMet) return "CLOSED";
  if (status.active) return "ACTIVE";
  return "APPROVED";
}

async function syncExistingLoanHistory(prisma: PrismaClient, loanId: string, payload: Record<string, unknown>) {
  const legacyLoanId = Number(payload.id);
  const currency = (payload.currency as Record<string, unknown>).code as string;
  const exponent = Number((payload.currency as Record<string, unknown>).decimalPlaces ?? 2);
  const status = payload.status as Record<string, unknown>;
  const timeline = (payload.timeline ?? {}) as Record<string, unknown>;
  const summary = (payload.summary ?? {}) as Record<string, unknown>;
  const schedule = (payload.repaymentSchedule as Record<string, unknown> | undefined)?.periods as Array<Record<string, unknown>> | undefined;
  const transactions = (payload.transactions as Array<Record<string, unknown>>) ?? [];

  return prisma.$transaction(async (transaction) => {
    const currentLoan = await transaction.loan.findUniqueOrThrow({
      where: { id: loanId },
      select: { status: true, disbursedOn: true, maturesOn: true },
    });
    const mappedStatus = mapLoanStatus(status);
    const safeStatus =
      currentLoan.status === "IN_ARREARS" && mappedStatus === "ACTIVE"
        ? currentLoan.status
        : mappedStatus !== "WRITTEN_OFF" && mappedStatus !== "OVERPAID" && mappedStatus !== "CLOSED" && currentLoan.status !== "APPROVED"
          ? currentLoan.status
          : mappedStatus;
    const disbursedOn = dateFromParts(timeline.actualDisbursementDate);
    const maturesOn = dateFromParts(timeline.expectedMaturityDate) ?? dateFromParts(timeline.closedOnDate);

    await transaction.loan.update({
      where: { id: loanId },
      data: {
        denominationCurrency: currency,
        status: safeStatus,
        disbursedOn: disbursedOn ?? currentLoan.disbursedOn,
        maturesOn: maturesOn ?? currentLoan.maturesOn,
        principalWrittenOffMinor: toMinor(Number(summary.principalWrittenOff ?? 0), exponent),
        interestWrittenOffMinor: toMinor(Number(summary.interestWrittenOff ?? 0), exponent),
        feesWrittenOffMinor: toMinor(Number(summary.feeChargesWrittenOff ?? 0), exponent),
        penaltiesWrittenOffMinor: toMinor(Number(summary.penaltyChargesWrittenOff ?? 0), exponent),
      },
    });

    let installmentsUpdated = 0;
    for (const period of schedule ?? []) {
      const installmentNumber = Number(period.period ?? 0);
      if (installmentNumber <= 0) continue;
      await transaction.loanInstallment.upsert({
        where: { loanId_installmentNumber: { loanId, installmentNumber } },
        create: {
          loanId,
          installmentNumber,
          dueOn: dateFromParts(period.dueDate) ?? new Date(),
          principalDueMinor: toMinor(Number(period.principalOriginalDue ?? 0), exponent),
          interestDueMinor: toMinor(Number(period.interestOriginalDue ?? 0), exponent),
          feesDueMinor: toMinor(Number(period.feeChargesDue ?? 0), exponent),
          penaltiesDueMinor: toMinor(Number(period.penaltyChargesDue ?? 0), exponent),
          principalPaidMinor: toMinor(Number(period.principalPaid ?? 0), exponent),
          interestPaidMinor: toMinor(Number(period.interestPaid ?? 0), exponent),
          feesPaidMinor: toMinor(Number(period.feeChargesPaid ?? 0), exponent),
          penaltiesPaidMinor: toMinor(Number(period.penaltyChargesPaid ?? 0), exponent),
          principalWaivedMinor: toMinor(Number(period.principalWaived ?? 0), exponent),
          interestWaivedMinor: toMinor(Number(period.interestWaived ?? 0), exponent),
          feesWaivedMinor: toMinor(Number(period.feeChargesWaived ?? 0), exponent),
          penaltiesWaivedMinor: toMinor(Number(period.penaltyChargesWaived ?? 0), exponent),
        },
        update: {
          dueOn: dateFromParts(period.dueDate) ?? undefined,
          principalDueMinor: toMinor(Number(period.principalOriginalDue ?? 0), exponent),
          interestDueMinor: toMinor(Number(period.interestOriginalDue ?? 0), exponent),
          feesDueMinor: toMinor(Number(period.feeChargesDue ?? 0), exponent),
          penaltiesDueMinor: toMinor(Number(period.penaltyChargesDue ?? 0), exponent),
          principalPaidMinor: toMinor(Number(period.principalPaid ?? 0), exponent),
          interestPaidMinor: toMinor(Number(period.interestPaid ?? 0), exponent),
          feesPaidMinor: toMinor(Number(period.feeChargesPaid ?? 0), exponent),
          penaltiesPaidMinor: toMinor(Number(period.penaltyChargesPaid ?? 0), exponent),
          principalWaivedMinor: toMinor(Number(period.principalWaived ?? 0), exponent),
          interestWaivedMinor: toMinor(Number(period.interestWaived ?? 0), exponent),
          feesWaivedMinor: toMinor(Number(period.feeChargesWaived ?? 0), exponent),
          penaltiesWaivedMinor: toMinor(Number(period.penaltyChargesWaived ?? 0), exponent),
        },
      });
      installmentsUpdated += 1;
    }

    let transactionsImported = 0;
    const createdTransactionIds = new Map<unknown, string>();
    for (const txn of transactions) {
      const idempotencyKey = `legacy-loan-${legacyLoanId}-txn-${txn.id}`;
      const existing = await transaction.loanTransaction.findUnique({
        where: { idempotencyKey },
        select: { id: true, reversedById: true },
      });
      if (existing) {
        createdTransactionIds.set(txn.id, existing.id);
        continue;
      }

      const amountMinor = toMinor(Number(txn.amount ?? 0), exponent);
      const created = await transaction.loanTransaction.create({
        data: {
          loanId,
          transactionType: normalizeLegacyLoanTransactionType(String((txn.type as Record<string, unknown> | undefined)?.code ?? "unknown")),
          businessDate: dateFromParts(txn.date) ?? new Date(),
          settlementCurrency: currency,
          settlementChannel: "CASH",
          settlementAmountMinor: amountMinor,
          denominationAmountMinor: amountMinor,
          externalReference: `legacy:${legacyLoanId}:${txn.id}`,
          idempotencyKey,
        },
      });
      createdTransactionIds.set(txn.id, created.id);
      transactionsImported += 1;
    }

    for (const txn of transactions) {
      if (!txn.manuallyReversed) continue;
      const originalId = createdTransactionIds.get(txn.id);
      if (!originalId) continue;
      const original = await transaction.loanTransaction.findUnique({
        where: { id: originalId },
        select: { id: true, transactionType: true, businessDate: true, settlementCurrency: true, settlementChannel: true, settlementAmountMinor: true, denominationAmountMinor: true, reversedById: true },
      });
      if (!original || original.reversedById) continue;
      const reversalIdempotencyKey = `legacy-loan-${legacyLoanId}-txn-${txn.id}-reversal`;
      const existingReversal = await transaction.loanTransaction.findUnique({ where: { idempotencyKey: reversalIdempotencyKey }, select: { id: true } });
      const reversalId = existingReversal?.id ?? (await transaction.loanTransaction.create({
        data: {
          loanId,
          transactionType: normalizeLegacyLoanTransactionType(`${String((txn.type as Record<string, unknown> | undefined)?.code ?? "unknown")}.reversal`),
          businessDate: dateFromParts(txn.date) ?? original.businessDate,
          settlementCurrency: original.settlementCurrency,
          settlementChannel: original.settlementChannel,
          settlementAmountMinor: original.settlementAmountMinor,
          denominationAmountMinor: original.denominationAmountMinor,
          externalReference: `legacy:${legacyLoanId}:${txn.id}:reversal`,
          idempotencyKey: reversalIdempotencyKey,
        },
      })).id;
      if (!existingReversal) transactionsImported += 1;
      await transaction.loanTransaction.update({ where: { id: original.id }, data: { reversedById: reversalId } });
    }

    return { transactionsImported, installmentsUpdated };
  });
}

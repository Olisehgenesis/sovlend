import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import Decimal from "decimal.js";
import type { PrismaClient } from "@prisma/client";

import { deterministicUuid } from "./import-foundation";

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
export async function importArchiveGroupsAndLoans(prisma: PrismaClient, root: string, organizationId: string, actorUserId: string) {
  const groupsImported = await importGroups(prisma, root, organizationId);
  const membersImported = await importGroupMembers(prisma, root, organizationId);
  const loanResult = await importLoans(prisma, root, organizationId, actorUserId);
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

async function importLoans(prisma: PrismaClient, root: string, organizationId: string, actorUserId: string) {
  const folder = path.join(root, "raw/loans");
  let files: string[];
  try {
    files = (await readdir(folder)).filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return { loansImported: 0, loansSkipped: [] as string[] };
  }

  let loansImported = 0;
  const loansSkipped: string[] = [];

  for (const file of files) {
    const loan = JSON.parse(await readFile(path.join(folder, file), "utf8")) as Record<string, unknown>;
    const legacyLoanId = Number(loan.id);
    const accountNumber = `LEGACY-${legacyLoanId}`;

    const alreadyImported = await prisma.loan.findFirst({ where: { accountNumber } });
    if (alreadyImported) continue;

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
            },
          });
        }

        for (const txn of transactions) {
          const amountMinor = toMinor(Number(txn.amount ?? 0), exponent);
          await transaction.loanTransaction.create({
            data: {
              loanId: createdLoan.id,
              transactionType: String((txn.type as Record<string, unknown> | undefined)?.code ?? "unknown"),
              businessDate: dateFromParts(txn.date) ?? new Date(),
              settlementCurrency: currency,
              settlementChannel: "CASH",
              settlementAmountMinor: amountMinor,
              denominationAmountMinor: amountMinor,
              externalReference: `legacy:${legacyLoanId}:${txn.id}`,
              idempotencyKey: `legacy-loan-${legacyLoanId}-txn-${txn.id}`,
            },
          });
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

  return { loansImported, loansSkipped };
}

function toMinor(amount: number, exponent = 2): bigint {
  return BigInt(new Decimal(amount).mul(new Decimal(10).pow(exponent)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
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

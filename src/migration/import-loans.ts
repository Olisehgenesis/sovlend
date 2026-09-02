import { createHash, randomUUID } from "node:crypto";

import Decimal from "decimal.js";

import { prisma as defaultPrisma } from "@/lib/prisma";

import type { ReadOnlyFineractClient } from "./fineract-client";

type PrismaLike = typeof defaultPrisma;

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

export type ImportLegacyLoansCommand = Readonly<{
  legacyClientId: number;
  clientId: string;
  organizationId: string;
  officeId: string;
  actorUserId: string;
}>;

export type ImportLegacyGroupLoansCommand = Readonly<{
  legacyGroupId: number;
  groupId: string;
  organizationId: string;
  officeId: string;
  actorUserId: string;
}>;

export type ImportLegacyLoansResult = Readonly<{
  loansImported: number;
  loansSkipped: readonly string[];
}>;

/**
 * Imports historical loan accounts (schedule + transaction history) as read-only records for
 * reporting/history purposes. Does NOT post journal/ledger entries — retroactively reconstructing
 * correct double-entry accounting for historical transactions is a separate, deliberate exercise.
 */
export async function importLegacyLoansForClient(prisma: PrismaLike, fineract: ReadOnlyFineractClient, command: ImportLegacyLoansCommand): Promise<ImportLegacyLoansResult> {
  const accounts = (await fineract.getClientAccounts(command.legacyClientId)) as { loanAccounts?: Array<{ id: number }> };
  const loanIds = accounts.loanAccounts?.map((account) => account.id) ?? [];
  return importLegacyLoanAccounts(prisma, fineract, loanIds, {
    owner: { clientId: command.clientId },
    organizationId: command.organizationId,
    officeId: command.officeId,
    actorUserId: command.actorUserId,
  });
}

/** Same as importLegacyLoansForClient but for a group-owned account (e.g. a SACCO-style "GROUP LOAN"). */
export async function importLegacyLoansForGroup(prisma: PrismaLike, fineract: ReadOnlyFineractClient, command: ImportLegacyGroupLoansCommand): Promise<ImportLegacyLoansResult> {
  const accounts = (await fineract.getGroupAccounts(command.legacyGroupId)) as { loanAccounts?: Array<{ id: number }> };
  const loanIds = accounts.loanAccounts?.map((account) => account.id) ?? [];
  return importLegacyLoanAccounts(prisma, fineract, loanIds, {
    owner: { groupId: command.groupId },
    organizationId: command.organizationId,
    officeId: command.officeId,
    actorUserId: command.actorUserId,
  });
}

async function importLegacyLoanAccounts(
  prisma: PrismaLike,
  fineract: ReadOnlyFineractClient,
  loanIds: readonly number[],
  command: Readonly<{ owner: { clientId: string } | { groupId: string }; organizationId: string; officeId: string; actorUserId: string }>,
): Promise<ImportLegacyLoansResult> {
  let loansImported = 0;
  const loansSkipped: string[] = [];

  for (const legacyLoanId of loanIds) {
    const alreadyImported = await prisma.loan.findFirst({ where: { accountNumber: `LEGACY-${legacyLoanId}` } });
    if (alreadyImported) continue;

    try {
      const loan = (await fineract.getLoan(legacyLoanId)) as Record<string, unknown>;
      const product = await prisma.loanProduct.findFirst({ where: { organizationId: command.organizationId, name: String(loan.loanProductName ?? "") } });
      if (!product) { loansSkipped.push(`Loan #${legacyLoanId}: no product named "${loan.loanProductName}" configured`); continue; }

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
            clientId: "clientId" in command.owner ? command.owner.clientId : null,
            groupId: "groupId" in command.owner ? command.owner.groupId : null,
            productId: product.id,
            officeId: command.officeId,
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
            clientId: "clientId" in command.owner ? command.owner.clientId : null,
            groupId: "groupId" in command.owner ? command.owner.groupId : null,
            productId: product.id,
            officeId: command.officeId,
            accountNumber: `LEGACY-${legacyLoanId}`,
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
            actorId: command.actorUserId,
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

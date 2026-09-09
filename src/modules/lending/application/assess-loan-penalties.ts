import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

import {
  computePenaltyAmountMinor,
  isInstallmentPenaltyAssessable,
  parseLateFeeRule,
} from "../domain/penalty-assessment";

export type PenaltyAssessmentSkip = Readonly<{
  loanId: string;
  installmentId: string;
  reason: string;
}>;

export type AssessLoanPenaltiesResult = Readonly<{
  assessedCount: number;
  skippedCount: number;
  skipped: readonly PenaltyAssessmentSkip[];
}>;

const MAX_RECORDED_SKIPS = 100;

export async function assessLoanPenalties(
  prisma: PrismaClient,
  options: { businessDate?: Date; lookbackBufferDays?: number } = {},
): Promise<AssessLoanPenaltiesResult> {
  const businessDate = toUtcDay(options.businessDate ?? new Date());
  const skipped: PenaltyAssessmentSkip[] = [];
  let skippedCount = 0;
  let assessedCount = 0;

  const recordSkip = (entry: PenaltyAssessmentSkip) => {
    skippedCount += 1;
    if (skipped.length < MAX_RECORDED_SKIPS) skipped.push(entry);
  };

  const loans = await prisma.loan.findMany({
    where: { status: { in: ["ACTIVE", "IN_ARREARS"] } },
    select: {
      id: true,
      officeId: true,
      accountNumber: true,
      denominationCurrency: true,
      product: {
        select: {
          lateFeeRule: true,
          accountingMapping: {
            select: {
              penaltyIncomeAccountId: true,
              penaltyReceivableAccountId: true,
            },
          },
        },
      },
      installments: {
        where: { penaltyAssessedOn: null },
        orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }],
        select: {
          id: true,
          installmentNumber: true,
          dueOn: true,
          penaltyAssessedOn: true,
          principalDueMinor: true,
          interestDueMinor: true,
          feesDueMinor: true,
          penaltiesDueMinor: true,
          monitoringFeeDueMinor: true,
          principalPaidMinor: true,
          interestPaidMinor: true,
          feesPaidMinor: true,
          penaltiesPaidMinor: true,
          monitoringFeePaidMinor: true,
          principalWaivedMinor: true,
          interestWaivedMinor: true,
          feesWaivedMinor: true,
          penaltiesWaivedMinor: true,
          monitoringFeeWaivedMinor: true,
        },
      },
    },
  });

  for (const loan of loans) {
    let rule: ReturnType<typeof parseLateFeeRule>;
    try {
      rule = parseLateFeeRule(loan.product.lateFeeRule);
    } catch (error) {
      for (const installment of loan.installments) {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: error instanceof Error ? error.message : "Invalid late fee rule",
        });
      }
      continue;
    }

    if (!rule) continue;

    for (const installment of loan.installments) {
      if (
        !isInstallmentPenaltyAssessable({
          dueOn: installment.dueOn,
          graceDays: rule.graceDays,
          today: businessDate,
          penaltyAssessedOn: installment.penaltyAssessedOn,
          lookbackBufferDays: options.lookbackBufferDays,
        })
      ) {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: "Installment is outside the one-time penalty assessment window",
        });
        continue;
      }

      const amountMinor = computePenaltyAmountMinor(rule, installment);
      if (amountMinor <= 0n) {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: "Penalty amount resolved to zero",
        });
        continue;
      }

      const mapping = loan.product.accountingMapping;
      if (!mapping?.penaltyReceivableAccountId || !mapping.penaltyIncomeAccountId) {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: "Penalty receivable or penalty income account is not configured",
        });
        continue;
      }

      const journalLines = [
        {
          accountId: mapping.penaltyReceivableAccountId,
          currencyCode: loan.denominationCurrency,
          direction: "DEBIT" as const,
          amountMinor,
          memo: "Penalty receivable",
        },
        {
          accountId: mapping.penaltyIncomeAccountId,
          currencyCode: loan.denominationCurrency,
          direction: "CREDIT" as const,
          amountMinor,
          memo: "Penalty income",
        },
      ];
      assertBalancedJournal(journalLines);

      const action = "loan.penalty.assessed";
      const correlationId = randomUUID();
      const metadata = {
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        installmentId: installment.id,
        installmentNumber: installment.installmentNumber,
        businessDate: businessDate.toISOString().slice(0, 10),
        dueOn: installment.dueOn.toISOString().slice(0, 10),
        penaltyAmountMinor: amountMinor.toString(),
        calculationType: rule.calculationType,
        graceDays: rule.graceDays,
        penaltyIncomeAccountId: mapping.penaltyIncomeAccountId,
        penaltyReceivableAccountId: mapping.penaltyReceivableAccountId,
      };
      const eventHash = createHash("sha256")
        .update(JSON.stringify({ correlationId, action, metadata }))
        .digest("hex");

      const assessed = await prisma.$transaction(
        async (transaction) => {
          const updated = await transaction.loanInstallment.updateMany({
            where: { id: installment.id, penaltyAssessedOn: null },
            data: {
              penaltiesDueMinor: { increment: amountMinor },
              penaltyAssessedOn: businessDate,
            },
          });
          if (updated.count !== 1) return false;

          const journal = await transaction.journal.create({
            data: {
              officeId: loan.officeId,
              businessDate,
              referenceType: "LOAN_PENALTY_ASSESSMENT",
              referenceId: installment.id,
              narration: `Penalty assessment ${loan.accountNumber} installment ${installment.installmentNumber}`,
              idempotencyKey: `penalty-assessment:${installment.id}`,
            },
          });
          await transaction.journalLine.createMany({
            data: journalLines.map(({ currencyCode: _currencyCode, ...line }) => ({
              journalId: journal.id,
              ...line,
            })),
          });
          await transaction.journal.update({
            where: { id: journal.id },
            data: { status: "POSTED", postedAt: new Date() },
          });
          await transaction.auditEvent.create({
            data: {
              actorId: null,
              action,
              entityType: "LoanInstallment",
              entityId: installment.id,
              correlationId,
              metadata,
              eventHash,
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateType: "Loan",
              aggregateId: loan.id,
              eventType: action,
              payload: metadata,
            },
          });

          return true;
        },
        { isolationLevel: "Serializable" },
      );

      if (assessed) {
        assessedCount += 1;
      } else {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: "Installment was already assessed by another transaction",
        });
      }
    }
  }

  return { assessedCount, skippedCount, skipped };
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

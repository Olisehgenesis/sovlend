import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { assertPeriodOpen, PeriodClosedError } from "@/modules/ledger/application/assert-period-open";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

import { computeAccruableInterestMinor, isInstallmentInterestAccruable } from "../domain/interest-accrual";

export type InterestAccrualSkip = Readonly<{
  loanId: string;
  installmentId: string;
  reason: string;
}>;

export type AssessLoanInterestAccrualsResult = Readonly<{
  accruedCount: number;
  skippedCount: number;
  skipped: readonly InterestAccrualSkip[];
}>;

const MAX_RECORDED_SKIPS = 100;

/**
 * Accruals (iLend/Mifos "Accrual Transactions"): recognizes an installment's interest as earned
 * income (Dr Interest Receivable / Cr Interest Income) once its due date passes, even though it
 * has not yet been collected in cash -- SovLend otherwise only recognizes interest income at
 * collection time (see post-repayment.ts), which understates income on an accrual-basis P&L for
 * installments that are due but unpaid. Structurally identical to assess-loan-penalties.ts: a
 * one-time, bounded-window batch job that marks each installment's interestAccruedOn so it is
 * never accrued twice, and so applyRepaymentInTransaction() can later route that installment's
 * interest collection to the receivable account instead of crediting income a second time (see
 * repayment-allocation.ts / post-repayment.ts).
 */
export async function assessLoanInterestAccruals(
  prisma: PrismaClient,
  options: { businessDate?: Date; lookbackBufferDays?: number } = {},
): Promise<AssessLoanInterestAccrualsResult> {
  const businessDate = toUtcDay(options.businessDate ?? new Date());
  const skipped: InterestAccrualSkip[] = [];
  let skippedCount = 0;
  let accruedCount = 0;

  const recordSkip = (entry: InterestAccrualSkip) => {
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
          accountingMapping: {
            select: {
              interestIncomeAccountId: true,
              interestReceivableAccountId: true,
            },
          },
        },
      },
      installments: {
        where: { interestAccruedOn: null },
        orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }],
        select: {
          id: true,
          installmentNumber: true,
          dueOn: true,
          interestAccruedOn: true,
          interestDueMinor: true,
          interestPaidMinor: true,
          interestWaivedMinor: true,
        },
      },
    },
  });

  for (const loan of loans) {
    const mapping = loan.product.accountingMapping;

    for (const installment of loan.installments) {
      if (
        !isInstallmentInterestAccruable({
          dueOn: installment.dueOn,
          today: businessDate,
          interestAccruedOn: installment.interestAccruedOn,
          lookbackBufferDays: options.lookbackBufferDays,
        })
      ) {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: "Installment is outside the one-time interest accrual window",
        });
        continue;
      }

      const amountMinor = computeAccruableInterestMinor(installment);
      if (amountMinor <= 0n) {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: "Interest is already fully collected or waived",
        });
        continue;
      }

      if (!mapping?.interestReceivableAccountId || !mapping.interestIncomeAccountId) {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: "Interest receivable or interest income account is not configured",
        });
        continue;
      }

      const journalLines = [
        {
          accountId: mapping.interestReceivableAccountId,
          currencyCode: loan.denominationCurrency,
          direction: "DEBIT" as const,
          amountMinor,
          memo: "Interest receivable",
        },
        {
          accountId: mapping.interestIncomeAccountId,
          currencyCode: loan.denominationCurrency,
          direction: "CREDIT" as const,
          amountMinor,
          memo: "Interest income",
        },
      ];
      assertBalancedJournal(journalLines);

      const action = "loan.interest.accrued";
      const correlationId = randomUUID();
      const metadata = {
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        installmentId: installment.id,
        installmentNumber: installment.installmentNumber,
        businessDate: businessDate.toISOString().slice(0, 10),
        dueOn: installment.dueOn.toISOString().slice(0, 10),
        accruedInterestMinor: amountMinor.toString(),
        interestIncomeAccountId: mapping.interestIncomeAccountId,
        interestReceivableAccountId: mapping.interestReceivableAccountId,
      };
      const eventHash = createHash("sha256")
        .update(JSON.stringify({ correlationId, action, metadata }))
        .digest("hex");

      let accrued: boolean;
      try {
        accrued = await prisma.$transaction(
          async (transaction) => {
            await assertPeriodOpen(transaction, { officeId: loan.officeId, businessDate });
            const updated = await transaction.loanInstallment.updateMany({
              where: { id: installment.id, interestAccruedOn: null },
              data: { interestAccruedOn: businessDate },
            });
            if (updated.count !== 1) return false;

            const journal = await transaction.journal.create({
              data: {
                officeId: loan.officeId,
                businessDate,
                referenceType: "LOAN_INTEREST_ACCRUAL",
                referenceId: installment.id,
                narration: `Interest accrual ${loan.accountNumber} installment ${installment.installmentNumber}`,
                idempotencyKey: `interest-accrual:${installment.id}`,
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
      } catch (error) {
        if (error instanceof PeriodClosedError) {
          recordSkip({
            loanId: loan.id,
            installmentId: installment.id,
            reason: error.message,
          });
          continue;
        }
        throw error;
      }

      if (accrued) {
        accruedCount += 1;
      } else {
        recordSkip({
          loanId: loan.id,
          installmentId: installment.id,
          reason: "Installment was already accrued by another transaction",
        });
      }
    }
  }

  return { accruedCount, skippedCount, skipped };
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

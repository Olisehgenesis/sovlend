import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";
import { canDisburseWithoutMakerCheckerSplit } from "@/modules/lending/application/loan-application-access";
import { recordSavingsTransactionInTransaction } from "@/modules/savings/application/post-savings-transaction";
import {
  buildLoanDisbursementSavingsIdempotencyKey,
  resolveSavingsLiabilityAccountId,
} from "@/modules/savings/application/savings-ledger";

import { generateRepaymentSchedule } from "../domain/repayment-schedule";

const termsSchema = z.object({
  annualRateBps: z.number().int().nonnegative(),
  monitoringFeeAnnualRateBps: z.number().int().nonnegative().default(0),
  repaymentCount: z.number().int().positive(),
  repaymentFrequency: z.string(),
  interestMethod: z.string(),
});

export type LoanDisbursementCommand = {
  loanId: string;
  actorUserId: string;
  // Which of the client's/group's savings accounts receives the net proceeds. Optional when
  // there is exactly one active account (or a designated default) to credit.
  savingsAccountId?: string;
  // Optional, informational only: which cash/bank/mobile-money channel the operator recorded as
  // "how" this payout was released (e.g. for reporting). Disbursement always credits the
  // borrower's savings account net of fees — this never feeds a ledger entry of its own.
  paymentMethodSettlementAccountId?: string;
  businessDate: Date;
  externalReference?: string;
  idempotencyKey: string;
};

async function resolveSavingsDestination(
  prisma: Pick<PrismaClient, "savingsAccount">,
  input: {
    clientId: string | null;
    groupId: string | null;
    currencyCode: string;
    requestedSavingsAccountId?: string;
  },
) {
  if (!input.clientId && !input.groupId) {
    throw new Error("Only client or group loans can be credited to a savings account");
  }

  const accounts = await prisma.savingsAccount.findMany({
    where: {
      ...(input.clientId ? { clientId: input.clientId } : { groupId: input.groupId }),
      status: "ACTIVE",
      currencyCode: input.currencyCode,
    },
    select: {
      id: true,
      accountNumber: true,
      isDefault: true,
      product: { select: { id: true, shortName: true } },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (accounts.length === 0) {
    throw new Error(
      input.clientId
        ? "Client has no active savings account available for loan disbursement"
        : "Group has no active savings account available for loan disbursement",
    );
  }

  if (input.requestedSavingsAccountId) {
    const selected = accounts.find((account) => account.id === input.requestedSavingsAccountId);
    if (!selected) {
      throw new Error("Selected savings account is not available");
    }
    return selected;
  }

  const defaultAccount = accounts.find((account) => account.isDefault);
  if (defaultAccount) return defaultAccount;
  if (accounts.length === 1) return accounts[0];
  throw new Error("Select which savings account should receive the disbursement");
}

export async function disburseLoan(
  prisma: PrismaClient,
  command: LoanDisbursementCommand,
) {
  const existing = await prisma.loanTransaction.findUnique({
    where: { idempotencyKey: command.idempotencyKey },
  });
  if (existing) return existing;

  const loan = await prisma.loan.findUnique({
    where: { id: command.loanId },
    include: {
      application: { include: { approvals: true } },
      product: { include: { accountingMapping: true } },
      office: true,
    },
  });
  if (!loan) throw new Error("Loan not found");
  if (loan.status !== "APPROVED") throw new Error("Only approved loans can be disbursed");
  if (loan.denominationCurrency !== "UGX") {
    throw new Error("Only UGX-denominated disbursement is enabled");
  }
  if (
    !canDisburseWithoutMakerCheckerSplit(
      (await prisma.user.findUnique({ where: { id: command.actorUserId }, select: { systemRole: true } }))
        ?.systemRole,
    ) &&
    (loan.application.submittedById === command.actorUserId ||
      loan.application.approvals.some((approval) => approval.reviewerId === command.actorUserId))
  ) {
    throw new Error(
      "Maker-checker violation: application makers and approvers cannot disburse this loan",
    );
  }

  const productMapping = loan.product.accountingMapping;
  if (!productMapping) {
    throw new Error("Loan product accounting mapping is required before disbursement");
  }

  // Optional, informational only (see LoanDisbursementCommand) — never used as a journal
  // destination. Validated when provided so bad/stale ids don't silently get recorded.
  const paymentMethodAccount = command.paymentMethodSettlementAccountId
    ? await prisma.settlementAccount.findFirst({
        where: {
          id: command.paymentMethodSettlementAccountId,
          organizationId: loan.office.organizationId,
          currencyCode: loan.denominationCurrency,
          active: true,
        },
      })
    : null;
  if (command.paymentMethodSettlementAccountId && !paymentMethodAccount) {
    throw new Error("Selected payment method is not available");
  }

  const terms = termsSchema.parse(loan.termsSnapshot);

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.loanDisburse,
    organizationId: loan.office.organizationId,
    officeId: loan.officeId,
    amountMinor: loan.principalMinor,
    currencyCode: loan.denominationCurrency,
  });

  const schedule = generateRepaymentSchedule({
    principalMinor: loan.principalMinor,
    annualRateBps: terms.annualRateBps,
    monitoringFeeAnnualRateBps: terms.monitoringFeeAnnualRateBps,
    repaymentCount: terms.repaymentCount,
    repaymentFrequency: terms.repaymentFrequency,
    interestMethod: terms.interestMethod,
    disbursedOn: command.businessDate,
  });

  return prisma.$transaction(
    async (transaction) => {
      const changed = await transaction.loan.updateMany({
        where: { id: loan.id, status: "APPROVED", disbursedOn: null },
        data: {
          status: "ACTIVE",
          disbursedOn: command.businessDate,
          maturesOn: schedule.at(-1)?.dueOn,
        },
      });
      if (changed.count !== 1) {
        throw new Error("Loan was already disbursed by another operation");
      }

      const immediateCharges = await transaction.charge.findMany({
        where: { loanId: loan.id, dueOn: null, status: "PENDING" },
        select: { id: true, amountMinor: true, name: true },
      });
      const feesMinor = immediateCharges.reduce((sum, charge) => sum + charge.amountMinor, 0n);
      const netProceedsMinor = loan.principalMinor - feesMinor;
      if (netProceedsMinor < 0n) {
        throw new Error("Disbursement fees exceed the approved principal");
      }

      // Separates disbursement-time charges into distinct income accounts by charge name (see
      // Problem 2 in the accounting audit: admission fee, processing fee, and generic fees must
      // never share one income line). Each falls back to the legacy feeIncomeAccountId when its
      // dedicated mapping isn't configured, so organizations that haven't set up the new fields
      // keep exactly today's single merged "Disbursement fees" line and error message.
      const feeBuckets = new Map<string, { amountMinor: bigint; labels: Set<string> }>();
      for (const charge of immediateCharges) {
        const nameLower = charge.name.toLowerCase();
        const { accountId, label, missingLabel } = nameLower.includes("admission")
          ? {
              accountId: productMapping.admissionFeeIncomeAccountId ?? productMapping.feeIncomeAccountId,
              label: "Admission fee",
              missingLabel: "Admission fee income account",
            }
          : nameLower.includes("processing")
            ? {
                accountId: productMapping.processingFeeIncomeAccountId ?? productMapping.feeIncomeAccountId,
                label: "Processing fee",
                missingLabel: "Processing fee income account",
              }
            : {
                accountId: productMapping.feeIncomeAccountId,
                label: "Disbursement fees",
                missingLabel: "Fee income account",
              };
        if (!accountId) {
          throw new Error(`${missingLabel} is not configured for this loan product`);
        }
        const bucket = feeBuckets.get(accountId);
        if (bucket) {
          bucket.amountMinor += charge.amountMinor;
          bucket.labels.add(label);
        } else {
          feeBuckets.set(accountId, { amountMinor: charge.amountMinor, labels: new Set([label]) });
        }
      }
      const feeJournalLines = [...feeBuckets.entries()].map(([accountId, bucket]) => ({
        accountId,
        currencyCode: loan.denominationCurrency,
        direction: "CREDIT" as const,
        amountMinor: bucket.amountMinor,
        memo: bucket.labels.size === 1 ? [...bucket.labels][0] : "Disbursement fees",
      }));

      // Disbursement always credits the borrower's savings account, net of any due-at-
      // disbursement charges — there is no "pay out via settlement account" path anymore.
      const savingsDestination = await resolveSavingsDestination(transaction, {
        clientId: loan.clientId,
        groupId: loan.groupId,
        currencyCode: loan.denominationCurrency,
        requestedSavingsAccountId: command.savingsAccountId,
      });
      const savingsLiabilityAccountId = await resolveSavingsLiabilityAccountId(transaction, {
        organizationId: loan.office.organizationId,
        savingsProductId: savingsDestination.product?.id ?? null,
        savingsProductShortName: savingsDestination.product?.shortName ?? null,
      });

      await transaction.loanInstallment.createMany({
        data: schedule.map((item) => ({ loanId: loan.id, ...item })),
      });

      const transactionRecord = await transaction.loanTransaction.create({
        data: {
          loanId: loan.id,
          transactionType: "DISBURSEMENT",
          businessDate: command.businessDate,
          settlementCurrency: loan.denominationCurrency,
          settlementChannel: paymentMethodAccount?.name ?? `Savings ${savingsDestination.accountNumber}`,
          settlementAccountId: paymentMethodAccount?.id,
          settlementAmountMinor: netProceedsMinor,
          denominationAmountMinor: loan.principalMinor,
          externalReference: command.externalReference,
          idempotencyKey: command.idempotencyKey,
          recordedByUserId: command.actorUserId,
        },
      });

      if (netProceedsMinor > 0n) {
        await recordSavingsTransactionInTransaction(transaction, {
          savingsAccountId: savingsDestination.id,
          actorUserId: command.actorUserId,
          transactionType: "DEPOSIT",
          amountMinor: netProceedsMinor,
          reason: "Loan disbursement",
          externalReference:
            command.externalReference ?? `Loan disbursement ${loan.accountNumber}`,
          idempotencyKey: buildLoanDisbursementSavingsIdempotencyKey(
            transactionRecord.id,
            "credit",
          ),
        });
      }

      if (immediateCharges.length > 0) {
        await transaction.charge.updateMany({
          where: { id: { in: immediateCharges.map((charge) => charge.id) } },
          data: { status: "PAID" },
        });
      }

      const journalLines = [
        {
          accountId: productMapping.principalReceivableAccountId,
          currencyCode: loan.denominationCurrency,
          direction: "DEBIT" as const,
          amountMinor: loan.principalMinor,
          memo: loan.accountNumber,
        },
        ...feeJournalLines,
        ...(netProceedsMinor > 0n
          ? [
              {
                accountId: savingsLiabilityAccountId,
                currencyCode: loan.denominationCurrency,
                direction: "CREDIT" as const,
                amountMinor: netProceedsMinor,
                memo: savingsDestination.accountNumber,
              },
            ]
          : []),
      ];
      assertBalancedJournal(journalLines);

      const journal = await transaction.journal.create({
        data: {
          officeId: loan.officeId,
          businessDate: command.businessDate,
          referenceType: "LOAN_DISBURSEMENT",
          referenceId: transactionRecord.id,
          narration: `Disbursement ${loan.accountNumber}`,
          idempotencyKey: `journal:${command.idempotencyKey}`,
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

      const correlationId = randomUUID();
      const metadata = {
        loanId: loan.id,
        transactionId: transactionRecord.id,
        paymentMethodAccountId: paymentMethodAccount?.id ?? null,
        paymentMethodAccount: paymentMethodAccount?.name ?? null,
        savingsAccountId: savingsDestination.id,
        savingsAccountNumber: savingsDestination.accountNumber,
        principalMinor: loan.principalMinor.toString(),
        feesMinor: feesMinor.toString(),
        netProceedsMinor: netProceedsMinor.toString(),
        externalReference: command.externalReference ?? null,
      };
      const eventHash = createHash("sha256")
        .update(JSON.stringify({ correlationId, action: "loan.disbursed", metadata }))
        .digest("hex");

      await transaction.auditEvent.create({
        data: {
          actorId: command.actorUserId,
          action: "loan.disbursed",
          entityType: "Loan",
          entityId: loan.id,
          correlationId,
          metadata,
          eventHash,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: "Loan",
          aggregateId: loan.id,
          eventType: "loan.disbursed",
          payload: metadata,
        },
      });

      return transactionRecord;
    },
    { isolationLevel: "Serializable" },
  );
}

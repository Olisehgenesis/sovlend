import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { calculateLoanPayoff, type PayoffInstallment } from "../domain/loan-payoff";

export const loanServiceActionTypes = ["UNDO_DISBURSAL", "PREPAY", "FORECLOSURE", "TRANSACTION_REVERSAL"] as const;
export type LoanServiceActionType = (typeof loanServiceActionTypes)[number];

const undoDisbursalPayloadSchema = z.object({ businessDate: z.iso.date() });
const prepayPayloadSchema = z.object({ businessDate: z.iso.date(), settlementAccountId: z.string().uuid(), waivePenalties: z.boolean().optional() });
const foreclosurePayloadSchema = z.object({ businessDate: z.iso.date(), settlementAccountId: z.string().uuid() });
const reversalPayloadSchema = z.object({ businessDate: z.iso.date(), transactionId: z.string().uuid() });

export type UndoDisbursalPayload = z.infer<typeof undoDisbursalPayloadSchema>;
export type PrepayPayload = z.infer<typeof prepayPayloadSchema>;
export type ForeclosurePayload = z.infer<typeof foreclosurePayloadSchema>;
export type ReversalPayload = z.infer<typeof reversalPayloadSchema>;

export function parseServiceActionPayload(actionType: LoanServiceActionType, payload: unknown) {
  if (actionType === "UNDO_DISBURSAL") return undoDisbursalPayloadSchema.parse(payload);
  if (actionType === "PREPAY") return prepayPayloadSchema.parse(payload);
  if (actionType === "FORECLOSURE") return foreclosurePayloadSchema.parse(payload);
  return reversalPayloadSchema.parse(payload);
}

const openLoanStatuses = ["ACTIVE", "IN_ARREARS", "OVERPAID"] as const;

/**
 * Stage a high-risk servicing action for maker-checker review. The requesting user's
 * parameters are captured in full here; the checker in `decideLoanServiceAction` may only
 * approve or reject them, never alter them, which keeps the audit trail unambiguous.
 */
export async function requestLoanServiceAction(
  prisma: PrismaClient,
  command: { loanId: string; actorUserId: string; actionType: LoanServiceActionType; reason?: string; payload: unknown; idempotencyKey: string },
) {
  const existing = await prisma.loanServiceRequest.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) return existing;

  const payload = parseServiceActionPayload(command.actionType, command.payload);
  const loan = await prisma.loan.findUnique({ where: { id: command.loanId }, include: { office: true, transactions: true } });
  if (!loan) throw new Error("Loan not found");

  await new AuthorizationService(prisma).assertAllowed({ actorUserId: command.actorUserId, permission: permissions.loanReverse, organizationId: loan.office.organizationId, officeId: loan.officeId });

  if (command.actionType === "UNDO_DISBURSAL") {
    if (loan.status !== "ACTIVE" || !loan.disbursedOn) throw new Error("Only active, disbursed loans can have disbursal undone");
    const nonDisbursement = loan.transactions.filter((item) => item.transactionType !== "DISBURSEMENT");
    if (nonDisbursement.length > 0) throw new Error("Cannot undo disbursal after other transactions have been posted against this loan");
    const disbursement = loan.transactions.find((item) => item.transactionType === "DISBURSEMENT");
    if (!disbursement || disbursement.reversedById) throw new Error("Disbursement transaction is unavailable for reversal");
  } else if (command.actionType === "PREPAY") {
    if (!openLoanStatuses.includes(loan.status as (typeof openLoanStatuses)[number])) throw new Error("Loan is not open for prepayment");
  } else if (command.actionType === "FORECLOSURE") {
    if (!(["ACTIVE", "IN_ARREARS"] as const).includes(loan.status as "ACTIVE" | "IN_ARREARS")) throw new Error("Loan is not open for foreclosure");
  } else {
    const reversalPayload = payload as ReversalPayload;
    const transaction = loan.transactions.find((item) => item.id === reversalPayload.transactionId);
    if (!transaction) throw new Error("Transaction does not belong to this loan");
    if (transaction.transactionType !== "REPAYMENT") throw new Error("Only repayment transactions can be reversed through this workflow");
    if (transaction.reversedById) throw new Error("Transaction has already been reversed");
  }

  const pending = await prisma.loanServiceRequest.findFirst({ where: { loanId: loan.id, status: "PENDING" } });
  if (pending) throw new Error("A servicing action is already pending approval for this loan");

  return prisma.$transaction(async (tx) => {
    const request = await tx.loanServiceRequest.create({
      data: { loanId: loan.id, actionType: command.actionType, reason: command.reason, payload, idempotencyKey: command.idempotencyKey, requestedById: command.actorUserId },
    });
    const correlationId = randomUUID();
    const metadata = { loanId: loan.id, requestId: request.id, actionType: command.actionType, reason: command.reason ?? null };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.service_action.requested", metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: command.actorUserId, action: "loan.service_action.requested", entityType: "Loan", entityId: loan.id, correlationId, metadata, eventHash } });
    await tx.outboxEvent.create({ data: { aggregateType: "Loan", aggregateId: loan.id, eventType: "loan.service_action.requested", payload: metadata } });
    return request;
  });
}

/**
 * Approve or reject a pending servicing request. Approval executes the underlying reversal /
 * prepay / foreclosure atomically in the same database transaction as the status change, so a
 * request can never be left "approved" without its financial effects applied.
 */
export async function decideLoanServiceAction(
  prisma: PrismaClient,
  command: { requestId: string; actorUserId: string; decision: "APPROVE" | "REJECT"; note?: string },
) {
  const request = await prisma.loanServiceRequest.findUnique({ where: { id: command.requestId } });
  if (!request) throw new Error("Service request not found");
  if (request.status !== "PENDING") return request;
  if (request.requestedById === command.actorUserId) throw new Error("Maker-checker violation: the requester cannot decide their own servicing action");

  const loan = await prisma.loan.findUnique({ where: { id: request.loanId }, include: { office: true } });
  if (!loan) throw new Error("Loan not found");
  await new AuthorizationService(prisma).assertAllowed({ actorUserId: command.actorUserId, permission: permissions.loanReverse, organizationId: loan.office.organizationId, officeId: loan.officeId });

  if (command.decision === "REJECT") {
    return prisma.loanServiceRequest.update({ where: { id: request.id }, data: { status: "REJECTED", decidedById: command.actorUserId, decidedAt: new Date(), decisionNote: command.note } });
  }

  const actionType = request.actionType as LoanServiceActionType;
  const payload = parseServiceActionPayload(actionType, request.payload);

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.loanServiceRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (fresh.status !== "PENDING") return fresh;

    let resultTransactionId: string;
    if (actionType === "UNDO_DISBURSAL") {
      resultTransactionId = await executeUndoDisbursal(tx, loan.id, payload as UndoDisbursalPayload, request.id, command.actorUserId);
    } else if (actionType === "PREPAY") {
      resultTransactionId = await executeFullSettlement(tx, loan.id, payload as PrepayPayload, request.id, "PREPAYMENT", command.actorUserId);
    } else if (actionType === "FORECLOSURE") {
      resultTransactionId = await executeFullSettlement(tx, loan.id, { ...(payload as ForeclosurePayload), waivePenalties: true }, request.id, "FORECLOSURE", command.actorUserId);
    } else {
      resultTransactionId = await executeTransactionReversal(tx, loan.id, payload as ReversalPayload, request.id, command.actorUserId);
    }

    return tx.loanServiceRequest.update({ where: { id: request.id }, data: { status: "APPROVED", decidedById: command.actorUserId, decidedAt: new Date(), decisionNote: command.note, resultTransactionId } });
  }, { isolationLevel: "Serializable" });
}

export async function previewLoanPayoff(
  prisma: PrismaClient,
  command: { loanId: string; actorUserId: string; asOfDate: Date; waivePenalties?: boolean },
) {
  const loan = await prisma.loan.findUnique({ where: { id: command.loanId }, include: { office: true, installments: true } });
  if (!loan) throw new Error("Loan not found");
  await new AuthorizationService(prisma).assertAllowed({ actorUserId: command.actorUserId, permission: permissions.loanReverse, organizationId: loan.office.organizationId, officeId: loan.officeId });
  return calculateLoanPayoff(loan.installments, { asOfDate: command.asOfDate, waivePenalties: command.waivePenalties });
}

type Tx = Prisma.TransactionClient;

async function executeUndoDisbursal(tx: Tx, loanId: string, payload: UndoDisbursalPayload, requestId: string, actorUserId: string) {
  const current = await tx.loan.findUniqueOrThrow({ where: { id: loanId }, include: { transactions: true, product: { include: { accountingMapping: true } } } });
  if (current.status !== "ACTIVE" || !current.disbursedOn) throw new Error("Loan is not in a disbursed state");
  const nonDisbursement = current.transactions.filter((item) => item.transactionType !== "DISBURSEMENT");
  if (nonDisbursement.length > 0) throw new Error("Cannot undo disbursal after other transactions have been posted against this loan");
  const disbursement = current.transactions.find((item) => item.transactionType === "DISBURSEMENT");
  if (!disbursement || disbursement.reversedById) throw new Error("Disbursement transaction is unavailable for reversal");
  const mapping = current.product.accountingMapping;
  if (!mapping) throw new Error("Loan product accounting mapping is required to reverse disbursement");
  if (!disbursement.settlementAccountId) throw new Error("Original disbursement has no settlement account on record");
  const settlement = await tx.settlementAccount.findUniqueOrThrow({ where: { id: disbursement.settlementAccountId } });
  const businessDate = new Date(`${payload.businessDate}T00:00:00.000Z`);
  const idempotencyKey = `service:${requestId}`;

  const reversal = await tx.loanTransaction.create({
    data: {
      loanId: current.id, transactionType: "DISBURSEMENT_REVERSAL", businessDate,
      settlementCurrency: disbursement.settlementCurrency, settlementChannel: disbursement.settlementChannel,
      settlementAccountId: disbursement.settlementAccountId, settlementAmountMinor: disbursement.settlementAmountMinor,
      denominationAmountMinor: disbursement.denominationAmountMinor, externalReference: disbursement.externalReference,
      idempotencyKey,
    },
  });
  await tx.loanTransaction.update({ where: { id: disbursement.id }, data: { reversedById: reversal.id } });
  // Safe to remove the generated schedule: the precondition above guarantees no repayment or
  // allocation has ever referenced these installments.
  await tx.loanInstallment.deleteMany({ where: { loanId: current.id } });

  const journal = await tx.journal.create({ data: { officeId: current.officeId, businessDate, referenceType: "LOAN_DISBURSEMENT_REVERSAL", referenceId: reversal.id, narration: `Undo disbursal ${current.accountNumber}`, idempotencyKey: `journal:${idempotencyKey}` } });
  await tx.journalLine.createMany({ data: [
    { journalId: journal.id, accountId: settlement.ledgerAccountId, direction: "DEBIT", amountMinor: disbursement.denominationAmountMinor, memo: settlement.name },
    { journalId: journal.id, accountId: mapping.principalReceivableAccountId, direction: "CREDIT", amountMinor: disbursement.denominationAmountMinor, memo: current.accountNumber },
  ] });
  await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

  await tx.loan.update({ where: { id: current.id }, data: { status: "APPROVED", disbursedOn: null, maturesOn: null } });

  await recordServiceAudit(tx, { loanId: current.id, actorUserId, action: "loan.disbursement.undone", metadata: { loanId: current.id, requestId, reversalTransactionId: reversal.id } });
  return reversal.id;
}

async function executeFullSettlement(tx: Tx, loanId: string, payload: PrepayPayload | ForeclosurePayload, requestId: string, transactionType: "PREPAYMENT" | "FORECLOSURE", actorUserId: string) {
  const current = await tx.loan.findUniqueOrThrow({ where: { id: loanId }, include: { installments: { orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }] }, product: { include: { accountingMapping: true } }, office: true } });
  if (!openLoanStatuses.includes(current.status as (typeof openLoanStatuses)[number])) throw new Error("Loan is not open for settlement");
  const mapping = current.product.accountingMapping;
  if (!mapping) throw new Error("Loan product accounting mapping is required before settlement");
  const settlement = await tx.settlementAccount.findFirst({ where: { id: payload.settlementAccountId, organizationId: current.office.organizationId, currencyCode: current.denominationCurrency, active: true } });
  if (!settlement) throw new Error("Selected settlement account is not available");
  const businessDate = new Date(`${payload.businessDate}T00:00:00.000Z`);
  const waivePenalties = transactionType === "FORECLOSURE" ? true : Boolean((payload as PrepayPayload).waivePenalties);
  const quote = calculateLoanPayoff(current.installments as PayoffInstallment[], { asOfDate: businessDate, waivePenalties });
  if (quote.totalPayoffMinor <= 0n) throw new Error("Loan has no outstanding balance to settle");
  if (quote.interestAccruedMinor > 0n && !mapping.interestIncomeAccountId) throw new Error("Interest income account is not configured");
  if (quote.feesOutstandingMinor > 0n && !mapping.feeIncomeAccountId) throw new Error("Fee income account is not configured");
  if (quote.penaltiesCollectedMinor > 0n && !mapping.penaltyIncomeAccountId) throw new Error("Penalty income account is not configured");

  const idempotencyKey = `service:${requestId}`;
  const transactionRecord = await tx.loanTransaction.create({
    data: {
      loanId: current.id, transactionType, businessDate, settlementCurrency: current.denominationCurrency,
      settlementChannel: settlement.name, settlementAccountId: settlement.id,
      settlementAmountMinor: quote.totalPayoffMinor, denominationAmountMinor: quote.totalPayoffMinor,
      idempotencyKey,
    },
  });

  for (const item of quote.settlements) {
    await tx.loanInstallment.update({
      where: { id: item.installmentId },
      data: {
        principalPaidMinor: { increment: item.principalMinor },
        interestPaidMinor: { increment: item.interestCollectedMinor },
        feesPaidMinor: { increment: item.feesMinor },
        penaltiesPaidMinor: { increment: item.penaltiesCollectedMinor },
        interestWaivedMinor: { increment: item.interestWaivedMinor },
        penaltiesWaivedMinor: { increment: item.penaltiesWaivedMinor },
      },
    });
    if (item.principalMinor + item.interestCollectedMinor + item.feesMinor + item.penaltiesCollectedMinor > 0n) {
      await tx.loanTransactionAllocation.create({ data: { transactionId: transactionRecord.id, installmentId: item.installmentId, principalMinor: item.principalMinor, interestMinor: item.interestCollectedMinor, feesMinor: item.feesMinor, penaltiesMinor: item.penaltiesCollectedMinor } });
    }
  }

  const journal = await tx.journal.create({ data: { officeId: current.officeId, businessDate, referenceType: transactionType === "PREPAYMENT" ? "LOAN_PREPAYMENT" : "LOAN_FORECLOSURE", referenceId: transactionRecord.id, narration: `${transactionType === "PREPAYMENT" ? "Prepayment" : "Foreclosure"} ${current.accountNumber}`, idempotencyKey: `journal:${idempotencyKey}` } });
  const credits = [
    { accountId: mapping.principalReceivableAccountId, amount: quote.principalOutstandingMinor, memo: "Principal" },
    { accountId: mapping.interestIncomeAccountId, amount: quote.interestAccruedMinor, memo: "Interest" },
    { accountId: mapping.feeIncomeAccountId, amount: quote.feesOutstandingMinor, memo: "Fees" },
    { accountId: mapping.penaltyIncomeAccountId, amount: quote.penaltiesCollectedMinor, memo: "Penalties" },
  ].filter((line): line is { accountId: string; amount: bigint; memo: string } => Boolean(line.accountId) && line.amount > 0n);
  await tx.journalLine.createMany({ data: [
    { journalId: journal.id, accountId: settlement.ledgerAccountId, direction: "DEBIT", amountMinor: quote.totalPayoffMinor, memo: settlement.name },
    ...credits.map((line) => ({ journalId: journal.id, accountId: line.accountId, direction: "CREDIT" as const, amountMinor: line.amount, memo: line.memo })),
  ] });
  await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

  await tx.loan.update({ where: { id: current.id }, data: { status: "CLOSED" } });

  await recordServiceAudit(tx, {
    loanId: current.id, actorUserId,
    action: transactionType === "PREPAYMENT" ? "loan.prepaid" : "loan.foreclosed",
    metadata: {
      loanId: current.id, requestId, transactionId: transactionRecord.id, businessDate: payload.businessDate,
      principalOutstandingMinor: quote.principalOutstandingMinor.toString(), interestAccruedMinor: quote.interestAccruedMinor.toString(),
      interestWaivedMinor: quote.interestWaivedMinor.toString(), feesOutstandingMinor: quote.feesOutstandingMinor.toString(),
      penaltiesCollectedMinor: quote.penaltiesCollectedMinor.toString(), penaltiesWaivedMinor: quote.penaltiesWaivedMinor.toString(),
      totalPayoffMinor: quote.totalPayoffMinor.toString(),
    },
  });
  return transactionRecord.id;
}

async function executeTransactionReversal(tx: Tx, loanId: string, payload: ReversalPayload, requestId: string, actorUserId: string) {
  const original = await tx.loanTransaction.findUniqueOrThrow({ where: { id: payload.transactionId }, include: { allocations: true } });
  if (original.loanId !== loanId) throw new Error("Transaction does not belong to this loan");
  if (original.transactionType !== "REPAYMENT") throw new Error("Only repayment transactions can be reversed through this workflow");
  if (original.reversedById) throw new Error("Transaction has already been reversed");
  if (!original.settlementAccountId) throw new Error("Original transaction has no settlement account on record");

  const current = await tx.loan.findUniqueOrThrow({ where: { id: loanId }, include: { product: { include: { accountingMapping: true } } } });
  const mapping = current.product.accountingMapping;
  if (!mapping) throw new Error("Loan product accounting mapping is required to reverse this transaction");
  const settlement = await tx.settlementAccount.findUniqueOrThrow({ where: { id: original.settlementAccountId } });
  const businessDate = new Date(`${payload.businessDate}T00:00:00.000Z`);
  const idempotencyKey = `service:${requestId}`;

  const reversal = await tx.loanTransaction.create({
    data: {
      loanId: current.id, transactionType: "REPAYMENT_REVERSAL", businessDate,
      settlementCurrency: original.settlementCurrency, settlementChannel: original.settlementChannel,
      settlementAccountId: original.settlementAccountId, settlementAmountMinor: original.settlementAmountMinor,
      denominationAmountMinor: original.denominationAmountMinor, externalReference: original.externalReference,
      idempotencyKey,
    },
  });
  await tx.loanTransaction.update({ where: { id: original.id }, data: { reversedById: reversal.id } });

  let principalMinor = 0n;
  let interestMinor = 0n;
  let feesMinor = 0n;
  let penaltiesMinor = 0n;
  for (const allocation of original.allocations) {
    await tx.loanInstallment.update({
      where: { id: allocation.installmentId },
      data: {
        principalPaidMinor: { decrement: allocation.principalMinor },
        interestPaidMinor: { decrement: allocation.interestMinor },
        feesPaidMinor: { decrement: allocation.feesMinor },
        penaltiesPaidMinor: { decrement: allocation.penaltiesMinor },
      },
    });
    await tx.loanTransactionAllocation.create({ data: { transactionId: reversal.id, installmentId: allocation.installmentId, principalMinor: allocation.principalMinor, interestMinor: allocation.interestMinor, feesMinor: allocation.feesMinor, penaltiesMinor: allocation.penaltiesMinor } });
    principalMinor += allocation.principalMinor;
    interestMinor += allocation.interestMinor;
    feesMinor += allocation.feesMinor;
    penaltiesMinor += allocation.penaltiesMinor;
  }

  const journal = await tx.journal.create({ data: { officeId: current.officeId, businessDate, referenceType: "LOAN_REPAYMENT_REVERSAL", referenceId: reversal.id, narration: `Reversal of repayment ${current.accountNumber}`, idempotencyKey: `journal:${idempotencyKey}` } });
  const debits = [
    { accountId: mapping.principalReceivableAccountId, amount: principalMinor, memo: "Principal" },
    { accountId: mapping.interestIncomeAccountId, amount: interestMinor, memo: "Interest" },
    { accountId: mapping.feeIncomeAccountId, amount: feesMinor, memo: "Fees" },
    { accountId: mapping.penaltyIncomeAccountId, amount: penaltiesMinor, memo: "Penalties" },
  ].filter((line): line is { accountId: string; amount: bigint; memo: string } => Boolean(line.accountId) && line.amount > 0n);
  await tx.journalLine.createMany({ data: [
    ...debits.map((line) => ({ journalId: journal.id, accountId: line.accountId, direction: "DEBIT" as const, amountMinor: line.amount, memo: line.memo })),
    { journalId: journal.id, accountId: settlement.ledgerAccountId, direction: "CREDIT", amountMinor: original.settlementAmountMinor, memo: original.settlementChannel },
  ] });
  await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

  const freshInstallments = await tx.loanInstallment.findMany({ where: { loanId: current.id } });
  const outstanding = (item: (typeof freshInstallments)[number]) => item.principalDueMinor + item.interestDueMinor + item.feesDueMinor + item.penaltiesDueMinor
    - item.principalPaidMinor - item.interestPaidMinor - item.feesPaidMinor - item.penaltiesPaidMinor
    - item.principalWaivedMinor - item.interestWaivedMinor - item.feesWaivedMinor - item.penaltiesWaivedMinor;
  const totalOutstandingMinor = freshInstallments.reduce((sum, item) => sum + outstanding(item), 0n);
  const overdueOutstandingMinor = freshInstallments.filter((item) => item.dueOn < businessDate).reduce((sum, item) => sum + outstanding(item), 0n);
  // Reversing a repayment can only ever increase what is owed, so a loan that was CLOSED or
  // OVERPAID must reopen once a balance remains; it never gets waived away by this action.
  const nextStatus = totalOutstandingMinor > 0n ? (overdueOutstandingMinor > 0n ? "IN_ARREARS" : "ACTIVE") : (current.status === "OVERPAID" ? "OVERPAID" : "CLOSED");
  await tx.loan.update({ where: { id: current.id }, data: { status: nextStatus } });

  await recordServiceAudit(tx, { loanId: current.id, actorUserId, action: "loan.transaction.reversed", metadata: { loanId: current.id, requestId, reversedTransactionId: original.id, reversalTransactionId: reversal.id, amountMinor: original.denominationAmountMinor.toString() } });
  return reversal.id;
}

async function recordServiceAudit(tx: Tx, input: { loanId: string; actorUserId: string; action: string; metadata: Prisma.InputJsonObject }) {
  const correlationId = randomUUID();
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: input.action, metadata: input.metadata })).digest("hex");
  await tx.auditEvent.create({ data: { actorId: input.actorUserId, action: input.action, entityType: "Loan", entityId: input.loanId, correlationId, metadata: input.metadata, eventHash } });
  await tx.outboxEvent.create({ data: { aggregateType: "Loan", aggregateId: input.loanId, eventType: input.action, payload: input.metadata } });
}

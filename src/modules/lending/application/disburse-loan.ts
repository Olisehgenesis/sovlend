import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { generateRepaymentSchedule } from "../domain/repayment-schedule";

const termsSchema = z.object({
  annualRateBps: z.number().int().nonnegative(),
  repaymentCount: z.number().int().positive(),
  repaymentFrequency: z.string(),
  interestMethod: z.string(),
});

export async function disburseLoan(
  prisma: PrismaClient,
  command: { loanId: string; actorUserId: string; settlementAccountId: string; businessDate: Date; externalReference?: string; idempotencyKey: string },
) {
  const existing = await prisma.loanTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) return existing;
  const loan = await prisma.loan.findUnique({
    where: { id: command.loanId },
    include: { application: { include: { approvals: true } }, product: { include: { accountingMapping: true } }, office: true },
  });
  if (!loan) throw new Error("Loan not found");
  if (loan.status !== "APPROVED") throw new Error("Only approved loans can be disbursed");
  if (loan.denominationCurrency !== "UGX") throw new Error("Only UGX-denominated disbursement is enabled");
  if (loan.application.submittedById === command.actorUserId || loan.application.approvals.some((approval) => approval.reviewerId === command.actorUserId)) {
    throw new Error("Maker-checker violation: application makers and approvers cannot disburse this loan");
  }
  const productMapping = loan.product.accountingMapping;
  if (!productMapping) throw new Error("Loan product accounting mapping is required before disbursement");
  const settlementAccount = await prisma.settlementAccount.findFirst({ where: { id: command.settlementAccountId, organizationId: loan.office.organizationId, currencyCode: loan.denominationCurrency, active: true } });
  if (!settlementAccount) throw new Error("Selected settlement account is not available");
  const terms = termsSchema.parse(loan.termsSnapshot);

  await new AuthorizationService(prisma).assertAllowed({ actorUserId: command.actorUserId, permission: permissions.loanDisburse, organizationId: loan.office.organizationId, officeId: loan.officeId, amountMinor: loan.principalMinor, currencyCode: loan.denominationCurrency });
  const schedule = generateRepaymentSchedule({ principalMinor: loan.principalMinor, annualRateBps: terms.annualRateBps, repaymentCount: terms.repaymentCount, repaymentFrequency: terms.repaymentFrequency, interestMethod: terms.interestMethod, disbursedOn: command.businessDate });
  const correlationId = randomUUID();
  const metadata = { loanId: loan.id, settlementAccountId: settlementAccount.id, settlementAccount: settlementAccount.name, amountMinor: loan.principalMinor.toString(), externalReference: command.externalReference ?? null };
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.disbursed", metadata })).digest("hex");

  return prisma.$transaction(async (transaction) => {
    const changed = await transaction.loan.updateMany({ where: { id: loan.id, status: "APPROVED", disbursedOn: null }, data: { status: "ACTIVE", disbursedOn: command.businessDate, maturesOn: schedule.at(-1)?.dueOn } });
    if (changed.count !== 1) throw new Error("Loan was already disbursed by another operation");
    await transaction.loanInstallment.createMany({ data: schedule.map((item) => ({ loanId: loan.id, ...item })) });
    const transactionRecord = await transaction.loanTransaction.create({ data: { loanId: loan.id, transactionType: "DISBURSEMENT", businessDate: command.businessDate, settlementCurrency: loan.denominationCurrency, settlementChannel: settlementAccount.name, settlementAccountId: settlementAccount.id, settlementAmountMinor: loan.principalMinor, denominationAmountMinor: loan.principalMinor, externalReference: command.externalReference, idempotencyKey: command.idempotencyKey } });
    const journal = await transaction.journal.create({ data: { officeId: loan.officeId, businessDate: command.businessDate, referenceType: "LOAN_DISBURSEMENT", referenceId: transactionRecord.id, narration: `Disbursement ${loan.accountNumber}`, idempotencyKey: `journal:${command.idempotencyKey}` } });
    await transaction.journalLine.createMany({ data: [
      { journalId: journal.id, accountId: productMapping.principalReceivableAccountId, direction: "DEBIT", amountMinor: loan.principalMinor, memo: loan.accountNumber },
      { journalId: journal.id, accountId: settlementAccount.ledgerAccountId, direction: "CREDIT", amountMinor: loan.principalMinor, memo: settlementAccount.name },
    ] });
    await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
    await transaction.auditEvent.create({ data: { actorId: command.actorUserId, action: "loan.disbursed", entityType: "Loan", entityId: loan.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "Loan", aggregateId: loan.id, eventType: "loan.disbursed", payload: metadata } });
    return transactionRecord;
  }, { isolationLevel: "Serializable" });
}
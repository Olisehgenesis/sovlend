import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { allocateRepayment } from "../domain/repayment-allocation";

export async function postRepayment(
  prisma: PrismaClient,
  command: { loanId: string; actorUserId: string; amountMinor: bigint; settlementAccountId: string; businessDate: Date; externalReference?: string; idempotencyKey: string },
) {
  if (command.amountMinor <= 0n) throw new Error("Repayment must be positive");
  const existing = await prisma.loanTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) return existing;
  const loan = await prisma.loan.findUnique({ where: { id: command.loanId }, include: { office: true } });
  if (!loan) throw new Error("Loan not found");
  if (!(["ACTIVE", "IN_ARREARS", "OVERPAID"] as const).includes(loan.status as "ACTIVE" | "IN_ARREARS" | "OVERPAID")) throw new Error("Loan is not open for repayment");
  if (loan.denominationCurrency !== "UGX") throw new Error("Only UGX-denominated repayments are enabled");
  await new AuthorizationService(prisma).assertAllowed({ actorUserId: command.actorUserId, permission: permissions.loanRepayment, organizationId: loan.office.organizationId, officeId: loan.officeId });

  return prisma.$transaction(async (transaction) => {
    const current = await transaction.loan.findUniqueOrThrow({ where: { id: loan.id }, include: { installments: { orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }] }, product: { include: { accountingMapping: true } }, office: true } });
    const duplicate = await transaction.loanTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
    if (duplicate) return duplicate;
    const mapping = current.product.accountingMapping;
    if (!mapping) throw new Error("Loan product accounting mapping is required before repayment");
    const settlement = await transaction.settlementAccount.findFirst({ where: { id: command.settlementAccountId, organizationId: current.office.organizationId, currencyCode: current.denominationCurrency, active: true } });
    if (!settlement) throw new Error("Selected settlement account is not available");
    const allocation = allocateRepayment(current.installments, command.amountMinor);
    if (allocation.interestMinor > 0n && !mapping.interestIncomeAccountId) throw new Error("Interest income account is not configured");
    if (allocation.feesMinor > 0n && !mapping.feeIncomeAccountId) throw new Error("Fee income account is not configured");
    if (allocation.penaltiesMinor > 0n && !mapping.penaltyIncomeAccountId) throw new Error("Penalty income account is not configured");
    if (allocation.overpaymentMinor > 0n && !mapping.overpaymentLiabilityAccountId) throw new Error("Overpayment liability account is not configured");

    const transactionRecord = await transaction.loanTransaction.create({ data: { loanId: current.id, transactionType: "REPAYMENT", businessDate: command.businessDate, settlementCurrency: current.denominationCurrency, settlementChannel: settlement.name, settlementAccountId: settlement.id, settlementAmountMinor: command.amountMinor, denominationAmountMinor: command.amountMinor, externalReference: command.externalReference, idempotencyKey: command.idempotencyKey } });
    for (const item of allocation.allocations) {
      await transaction.loanInstallment.update({ where: { id: item.installmentId }, data: { principalPaidMinor: { increment: item.principalMinor }, interestPaidMinor: { increment: item.interestMinor }, feesPaidMinor: { increment: item.feesMinor }, penaltiesPaidMinor: { increment: item.penaltiesMinor } } });
      await transaction.loanTransactionAllocation.create({ data: { transactionId: transactionRecord.id, installmentId: item.installmentId, principalMinor: item.principalMinor, interestMinor: item.interestMinor, feesMinor: item.feesMinor, penaltiesMinor: item.penaltiesMinor } });
    }
    const journal = await transaction.journal.create({ data: { officeId: current.officeId, businessDate: command.businessDate, referenceType: "LOAN_REPAYMENT", referenceId: transactionRecord.id, narration: `Repayment ${current.accountNumber}`, idempotencyKey: `journal:${command.idempotencyKey}` } });
    const credits = [
      { accountId: mapping.principalReceivableAccountId, amount: allocation.principalMinor, memo: "Principal" },
      { accountId: mapping.interestIncomeAccountId, amount: allocation.interestMinor, memo: "Interest" },
      { accountId: mapping.feeIncomeAccountId, amount: allocation.feesMinor, memo: "Fees" },
      { accountId: mapping.penaltyIncomeAccountId, amount: allocation.penaltiesMinor, memo: "Penalties" },
      { accountId: mapping.overpaymentLiabilityAccountId, amount: allocation.overpaymentMinor, memo: "Overpayment" },
    ].filter((line): line is { accountId: string; amount: bigint; memo: string } => Boolean(line.accountId) && line.amount > 0n);
    await transaction.journalLine.createMany({ data: [
      { journalId: journal.id, accountId: settlement.ledgerAccountId, direction: "DEBIT", amountMinor: command.amountMinor, memo: settlement.name },
      ...credits.map((line) => ({ journalId: journal.id, accountId: line.accountId, direction: "CREDIT" as const, amountMinor: line.amount, memo: line.memo })),
    ] });
    await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
    const totalOutstanding = current.installments.reduce((sum, installment) => sum + installment.principalDueMinor + installment.interestDueMinor + installment.feesDueMinor + installment.penaltiesDueMinor - installment.principalPaidMinor - installment.interestPaidMinor - installment.feesPaidMinor - installment.penaltiesPaidMinor, 0n);
    const remainingAfter = totalOutstanding - (command.amountMinor - allocation.overpaymentMinor);
    const allocatedByInstallment = new Map(allocation.allocations.map((item) => [item.installmentId, item]));
    const overdueRemainingAfter = current.installments.filter((installment) => installment.dueOn < command.businessDate).reduce((sum, installment) => {
      const item = allocatedByInstallment.get(installment.id);
      return sum + installment.principalDueMinor + installment.interestDueMinor + installment.feesDueMinor + installment.penaltiesDueMinor - installment.principalPaidMinor - installment.interestPaidMinor - installment.feesPaidMinor - installment.penaltiesPaidMinor - (item?.principalMinor ?? 0n) - (item?.interestMinor ?? 0n) - (item?.feesMinor ?? 0n) - (item?.penaltiesMinor ?? 0n);
    }, 0n);
    if (allocation.overpaymentMinor > 0n) await transaction.loan.update({ where: { id: current.id }, data: { status: "OVERPAID" } });
    else if (remainingAfter <= 0n) await transaction.loan.update({ where: { id: current.id }, data: { status: "CLOSED" } });
    else if (current.status === "IN_ARREARS" && overdueRemainingAfter <= 0n) await transaction.loan.update({ where: { id: current.id }, data: { status: "ACTIVE" } });
    const correlationId = randomUUID();
    const metadata = { loanId: current.id, amountMinor: command.amountMinor.toString(), settlementAccountId: settlement.id, settlementAccount: settlement.name, allocation: { principal: allocation.principalMinor.toString(), interest: allocation.interestMinor.toString(), fees: allocation.feesMinor.toString(), penalties: allocation.penaltiesMinor.toString(), overpayment: allocation.overpaymentMinor.toString() } };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.repayment.recorded", metadata })).digest("hex");
    await transaction.auditEvent.create({ data: { actorId: command.actorUserId, action: "loan.repayment.recorded", entityType: "Loan", entityId: current.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "Loan", aggregateId: current.id, eventType: "loan.repayment.recorded", payload: metadata } });
    return transactionRecord;
  }, { isolationLevel: "Serializable" });
}
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { determineServicingStatus } from "../domain/loan-status";

export async function classifyLoanArrears(prisma: PrismaClient, businessDate = new Date()) {
  const loans = await prisma.loan.findMany({ where: { status: { in: ["ACTIVE", "IN_ARREARS"] } }, include: { installments: true } });
  let changed = 0;
  for (const loan of loans) {
    const outstanding = (item: typeof loan.installments[number]) => item.principalDueMinor + item.interestDueMinor + item.feesDueMinor + item.penaltiesDueMinor - item.principalPaidMinor - item.interestPaidMinor - item.feesPaidMinor - item.penaltiesPaidMinor;
    const totalOutstandingMinor = loan.installments.reduce((sum, item) => sum + outstanding(item), 0n);
    const overdueOutstandingMinor = loan.installments.filter((item) => item.dueOn < businessDate).reduce((sum, item) => sum + outstanding(item), 0n);
    const nextStatus = determineServicingStatus({ currentStatus: loan.status, totalOutstandingMinor, overdueOutstandingMinor });
    if (nextStatus === loan.status) continue;
    const correlationId = randomUUID();
    const metadata = { loanId: loan.id, previousStatus: loan.status, status: nextStatus, businessDate: businessDate.toISOString().slice(0, 10), overdueOutstandingMinor: overdueOutstandingMinor.toString() };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.status.classified", metadata })).digest("hex");
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.loan.updateMany({ where: { id: loan.id, status: loan.status }, data: { status: nextStatus as "ACTIVE" | "IN_ARREARS" | "CLOSED" } });
      if (updated.count !== 1) return;
      await transaction.auditEvent.create({ data: { actorId: null, action: "loan.status.classified", entityType: "Loan", entityId: loan.id, correlationId, metadata, eventHash } });
      await transaction.outboxEvent.create({ data: { aggregateType: "Loan", aggregateId: loan.id, eventType: "loan.status.changed", payload: metadata } });
      changed += 1;
    });
  }
  return changed;
}
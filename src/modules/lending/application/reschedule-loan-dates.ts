import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { isLoanPaymentTransaction } from "@/lib/loan-transaction-type-variants";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { loanScopeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { installmentOutstandingMinor } from "../domain/loan-outstanding";
import { determineServicingStatus } from "../domain/loan-status";
import {
  planScheduleDateChange,
  ScheduleDateChangeError,
  utcDay,
  type ScheduleDateRow,
} from "../domain/schedule-date-change";

export class ScheduleChangeError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const OPEN_STATUSES = ["ACTIVE", "IN_ARREARS"] as const;

export async function rescheduleLoanDates(db: PrismaClient, scope: UserDataScope, command: {
  loanId: string;
  actorUserId: string;
  reason: string;
  expectedUpdatedAt: Date;
  dates: readonly { id: string; dueOn: string }[];
  businessDate?: Date;
}) {
  const reason = command.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new ScheduleChangeError("Enter a reason for the date change", 400);

  return db.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({
      where: { id: command.loanId, office: { organizationId: scope.organizationId }, ...loanScopeWhere(scope) },
      include: {
        installments: { orderBy: { installmentNumber: "asc" } },
        transactions: {
          where: { reversedById: null },
          select: {
            transactionType: true,
            allocations: {
              select: { installmentId: true, principalMinor: true, interestMinor: true, feesMinor: true, monitoringFeeMinor: true, penaltiesMinor: true },
            },
          },
        },
      },
    });
    if (!loan) throw new ScheduleChangeError("Loan not found", 404);
    if (!OPEN_STATUSES.includes(loan.status as (typeof OPEN_STATUSES)[number]) || !loan.disbursedOn) {
      throw new ScheduleChangeError("Due dates can be changed on an active or in-arrears loan", 409);
    }
    await new AuthorizationService(db).assertAllowed({
      actorUserId: command.actorUserId,
      permission: permissions.loanReschedule,
      organizationId: scope.organizationId,
      officeId: loan.officeId,
    });

    const paidInstallments = new Set<string>();
    for (const transaction of loan.transactions) {
      if (!isLoanPaymentTransaction(transaction.transactionType)) continue;
      for (const allocation of transaction.allocations) {
        const amount = allocation.principalMinor + allocation.interestMinor + allocation.feesMinor + allocation.monitoringFeeMinor + allocation.penaltiesMinor;
        if (amount > 0n) paidInstallments.add(allocation.installmentId);
      }
    }

    const rows: ScheduleDateRow[] = loan.installments.map((item) => ({
      id: item.id,
      installmentNumber: item.installmentNumber,
      dueOn: item.dueOn,
      outstandingMinor: installmentOutstandingMinor(item),
      penaltyAssessedOn: item.penaltyAssessedOn,
      interestAccruedOn: item.interestAccruedOn,
      hasActivePayment: paidInstallments.has(item.id),
    }));

    let plan: ReturnType<typeof planScheduleDateChange>;
    try {
      plan = planScheduleDateChange({ disbursedOn: loan.disbursedOn, installments: rows, proposed: command.dates });
    } catch (error) {
      if (error instanceof ScheduleDateChangeError) throw new ScheduleChangeError(error.message, 400);
      throw error;
    }

    const businessDate = command.businessDate ?? new Date();
    const nextDue = new Map(rows.map((row) => [row.id, row.dueOn]));
    for (const change of plan.changes) nextDue.set(change.id, change.to);
    let totalOutstandingMinor = 0n;
    let overdueOutstandingMinor = 0n;
    for (const row of rows) {
      totalOutstandingMinor += row.outstandingMinor;
      const dueOn = nextDue.get(row.id);
      if (dueOn && dueOn < businessDate) overdueOutstandingMinor += row.outstandingMinor;
    }
    const status = determineServicingStatus({ currentStatus: loan.status, totalOutstandingMinor, overdueOutstandingMinor });

    const changed = await tx.loan.updateMany({
      where: { id: loan.id, updatedAt: command.expectedUpdatedAt, status: { in: [...OPEN_STATUSES] } },
      data: { maturesOn: plan.maturesOn, status: status as "ACTIVE" | "IN_ARREARS" | "CLOSED", scheduleVersion: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ScheduleChangeError("Loan changed. Refresh and try again", 409);

    for (const change of plan.changes) {
      const updated = await tx.loanInstallment.updateMany({
        where: { id: change.id, loanId: loan.id, dueOn: change.from },
        data: { dueOn: change.to },
      });
      if (updated.count !== 1) throw new ScheduleChangeError("Loan changed. Refresh and try again", 409);
      await tx.charge.updateMany({
        where: { loanId: loan.id, status: "PENDING", dueOn: change.from },
        data: { dueOn: change.to },
      });
    }

    const changes = plan.changes.map((change) => ({
      installmentNumber: change.installmentNumber,
      from: utcDay(change.from),
      to: utcDay(change.to),
    }));
    const metadata = {
      loanId: loan.id,
      reason,
      changes,
      previousStatus: loan.status,
      status,
      maturesOn: utcDay(plan.maturesOn),
    };
    const correlationId = randomUUID();
    const action = "loan.schedule.rescheduled";
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: command.actorUserId, action, entityType: "Loan", entityId: loan.id, correlationId, metadata, eventHash } });
    await tx.loanNote.create({
      data: {
        loanId: loan.id,
        authorId: command.actorUserId,
        body: `Repayment dates changed. ${changes.map((change) => `Installment ${change.installmentNumber}: ${change.from} to ${change.to}`).join(". ")}. ${reason}`,
      },
    });
    if (status !== loan.status) {
      await tx.outboxEvent.create({
        data: { aggregateType: "Loan", aggregateId: loan.id, eventType: "loan.status.changed", payload: metadata },
      });
    }
    return { status, maturesOn: utcDay(plan.maturesOn), changes };
  });
}

import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

export type CreateAccountingClosureCommand = Readonly<{
  organizationId: string;
  officeId: string;
  actorUserId: string;
  closingDate: Date;
  comment: string | null;
}>;

function dateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Creates a period-end lock ("Closing Entries" in iLend/Mifos terms) for an office. Once
 * created, assertPeriodOpen() rejects any new journal posting dated on or before the latest
 * closingDate for that office. closingDate must move forward only -- a closure can never be
 * dated on/before the office's current latest closure, so the "latest row" is always
 * unambiguous and closures can never overlap or go backwards. There is intentionally no
 * delete/reopen in this first version; correcting a mistaken closure is an operational escape
 * hatch left for a future iteration, consistent with the conservative, opt-in design called for
 * by this feature.
 */
export async function createAccountingClosure(prisma: PrismaClient, command: CreateAccountingClosureCommand) {
  const office = await prisma.office.findFirst({ where: { id: command.officeId, organizationId: command.organizationId } });
  if (!office) throw new Error("Office not found for this organization");

  const latestClosure = await prisma.accountingClosure.findFirst({
    where: { officeId: command.officeId },
    orderBy: { closingDate: "desc" },
  });
  if (latestClosure && dateOnlyString(command.closingDate) <= dateOnlyString(latestClosure.closingDate)) {
    throw new Error(`The closing date must be after the current closing date (${dateOnlyString(latestClosure.closingDate)}) for this office`);
  }

  return prisma.$transaction(async (transaction) => {
    const closure = await transaction.accountingClosure.create({
      data: {
        organizationId: command.organizationId,
        officeId: command.officeId,
        closingDate: command.closingDate,
        comment: command.comment?.trim() || null,
        createdByUserId: command.actorUserId,
      },
    });

    const correlationId = randomUUID();
    const metadata = {
      closureId: closure.id,
      officeId: command.officeId,
      closingDate: dateOnlyString(command.closingDate),
      comment: closure.comment,
    };
    const eventHash = createHash("sha256")
      .update(JSON.stringify({ correlationId, action: "ledger.accounting_period_closed", metadata }))
      .digest("hex");
    await transaction.auditEvent.create({
      data: {
        actorId: command.actorUserId,
        action: "ledger.accounting_period_closed",
        entityType: "AccountingClosure",
        entityId: closure.id,
        correlationId,
        metadata,
        eventHash,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        aggregateType: "AccountingClosure",
        aggregateId: closure.id,
        eventType: "ledger.accounting_period_closed",
        payload: metadata,
      },
    });

    return closure;
  });
}

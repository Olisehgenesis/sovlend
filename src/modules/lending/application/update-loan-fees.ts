import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { processingFeeBps, processingFeeBpsSchema } from "@/modules/lending/domain/processing-fee";

export class LoanFeesError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function updateLoanFees(db: PrismaClient, scope: UserDataScope, command: {
  loanId: string; actorUserId: string; processingFeeBps: number; expectedUpdatedAt: Date;
}) {
  const rate = processingFeeBpsSchema.parse(command.processingFeeBps);
  return db.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({
      where: { id: command.loanId, office: { organizationId: scope.organizationId }, ...officeWhere(scope) },
    });
    if (!loan) throw new LoanFeesError("Loan not found", 404);
    if (loan.status !== "APPROVED" || loan.disbursedOn) throw new LoanFeesError("Fees can only be edited on an approved loan before disbursement", 409);
    if (loan.denominationCurrency !== "UGX") throw new LoanFeesError("Only UGX loan fees can be edited", 400);
    await new AuthorizationService(db).assertAllowed({
      actorUserId: command.actorUserId, permission: permissions.loanDisburse,
      organizationId: scope.organizationId, officeId: loan.officeId,
      amountMinor: loan.principalMinor, currencyCode: loan.denominationCurrency,
    });
    const snapshot = loan.termsSnapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new LoanFeesError("Loan terms must be reconciled before editing fees", 409);
    const before = processingFeeBps(snapshot);
    const changed = await tx.loan.updateMany({
      where: { id: loan.id, status: "APPROVED", disbursedOn: null, updatedAt: command.expectedUpdatedAt },
      data: { termsSnapshot: { ...snapshot as Prisma.InputJsonObject, processingFeeBps: rate } },
    });
    if (changed.count !== 1) throw new LoanFeesError("Loan changed. Refresh and try again", 409);
    const action = "loan.fees.updated";
    const correlationId = randomUUID();
    const metadata = { loanId: loan.id, beforeProcessingFeeBps: before, processingFeeBps: rate };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: command.actorUserId, action, entityType: "Loan", entityId: loan.id, correlationId, metadata, eventHash } });
    return { processingFeeBps: rate };
  });
}

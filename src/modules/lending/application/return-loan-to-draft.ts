import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { canReturnLoanToDraft } from "./return-loan-to-draft-access";

export class ReturnLoanToDraftError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function returnLoanToDraft(db: PrismaClient, scope: UserDataScope, command: {
  loanId: string; actorUserId: string; reason: string; expectedUpdatedAt: Date;
}) {
  return db.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({
      where: { id: command.loanId, office: { organizationId: scope.organizationId }, ...officeWhere(scope) },
      include: { application: true, charges: { select: { status: true } }, _count: { select: { transactions: true, installments: true } } },
    });
    if (!loan) throw new ReturnLoanToDraftError("Loan not found", 404);
    if (loan.status !== "APPROVED" || loan.disbursedOn || loan.application.status !== "APPROVED") throw new ReturnLoanToDraftError("Only approved, undisbursed loans can return to draft", 409);
    if (loan._count.transactions || loan._count.installments || loan.charges.some(charge => charge.status !== "PENDING")) throw new ReturnLoanToDraftError("Loan has financial history and cannot return to draft", 409);
    if (!await canReturnLoanToDraft(db, scope, {
      actorUserId: command.actorUserId, officeId: loan.officeId,
      principalMinor: loan.principalMinor, currencyCode: loan.denominationCurrency,
    })) throw new PermissionDeniedError("You cannot return this loan to draft");
    const reason = command.reason.trim();
    if (!reason || reason.length > 1000) throw new ReturnLoanToDraftError("Provide a reason up to 1,000 characters", 400);
    const locked = await tx.loan.updateMany({
      where: { id: loan.id, status: "APPROVED", disbursedOn: null, updatedAt: command.expectedUpdatedAt },
      data: { status: "DRAFT" },
    });
    if (locked.count !== 1) throw new ReturnLoanToDraftError("Loan changed. Refresh and try again", 409);
    const updated = await tx.loanApplication.updateMany({
      where: { id: loan.applicationId, status: "APPROVED", updatedAt: loan.application.updatedAt },
      data: { status: "DRAFT", approvedAt: null, approvedPrincipalMinor: null, proposedPrincipalMinor: loan.principalMinor, termsSnapshot: loan.termsSnapshot as Prisma.InputJsonObject },
    });
    if (updated.count !== 1) throw new ReturnLoanToDraftError("Application changed. Refresh and try again", 409);
    await tx.approval.updateMany({ where: { applicationId: loan.applicationId, revokedAt: null }, data: { revokedAt: new Date() } });
    const action = "loan.returned_to_draft";
    const correlationId = randomUUID();
    const metadata = { loanId: loan.id, applicationId: loan.applicationId, reason };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: command.actorUserId, action, entityType: "Loan", entityId: loan.id, correlationId, metadata, eventHash } });
    return { applicationId: loan.applicationId };
  });
}

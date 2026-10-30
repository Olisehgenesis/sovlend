import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { canReturnLoanToReview } from "./return-loan-to-draft-access";

export class ReturnLoanToReviewError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type ReviewTransaction = { id: string; transactionType: string; reversedById: string | null };

/** A paid-out loan can return to review only after every disbursement has a matching reversal and nothing else was posted. */
export function disbursementHistoryCanReturnToReview(transactions: ReviewTransaction[]) {
  const disbursements = transactions.filter((item) => item.transactionType === "DISBURSEMENT");
  const reversals = transactions.filter((item) => item.transactionType === "DISBURSEMENT_REVERSAL");
  if (disbursements.length + reversals.length !== transactions.length || disbursements.length !== reversals.length) return false;
  const reversalIds = new Set(reversals.map((item) => item.id));
  const linkedReversalIds = new Set(disbursements.map((item) => item.reversedById));
  return disbursements.every((item) => item.reversedById !== null && reversalIds.has(item.reversedById))
    && reversals.every((item) => linkedReversalIds.has(item.id));
}

export async function returnLoanToReview(db: PrismaClient, scope: UserDataScope, command: {
  loanId: string; actorUserId: string; reason: string; expectedUpdatedAt: Date;
}) {
  return db.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({
      where: { id: command.loanId, office: { organizationId: scope.organizationId }, ...officeWhere(scope) },
      include: {
        application: true,
        charges: { select: { status: true } },
        transactions: { select: { id: true, transactionType: true, reversedById: true } },
        _count: { select: { installments: true } },
      },
    });
    if (!loan) throw new ReturnLoanToReviewError("Loan not found", 404);
    if (loan.status !== "APPROVED" || loan.disbursedOn || loan.application.status !== "APPROVED") {
      throw new ReturnLoanToReviewError("Only approved, undisbursed loans can return to review", 409);
    }
    const collectedCharge = loan.charges.some((charge) => charge.status !== "PENDING" && charge.status !== "WAIVED");
    if (loan._count.installments || collectedCharge || !disbursementHistoryCanReturnToReview(loan.transactions)) {
      throw new ReturnLoanToReviewError("Loan has financial history and cannot return to review", 409);
    }
    if (!await canReturnLoanToReview(db, scope, {
      actorUserId: command.actorUserId, officeId: loan.officeId,
      principalMinor: loan.principalMinor, currencyCode: loan.denominationCurrency,
    })) throw new PermissionDeniedError("You cannot return this loan to review");
    const reason = command.reason.trim();
    if (!reason || reason.length > 1000) throw new ReturnLoanToReviewError("Provide a reason up to 1,000 characters", 400);
    const locked = await tx.loan.updateMany({
      where: { id: loan.id, status: "APPROVED", disbursedOn: null, updatedAt: command.expectedUpdatedAt },
      data: { status: "DRAFT" },
    });
    if (locked.count !== 1) throw new ReturnLoanToReviewError("Loan changed. Refresh and try again", 409);
    const updated = await tx.loanApplication.updateMany({
      where: { id: loan.applicationId, status: "APPROVED", updatedAt: loan.application.updatedAt },
      data: {
        status: "SUBMITTED",
        approvedAt: null,
        approvedPrincipalMinor: null,
        proposedPrincipalMinor: loan.principalMinor,
        termsSnapshot: loan.termsSnapshot as Prisma.InputJsonObject,
      },
    });
    if (updated.count !== 1) throw new ReturnLoanToReviewError("Application changed. Refresh and try again", 409);
    await tx.approval.updateMany({ where: { applicationId: loan.applicationId, revokedAt: null }, data: { revokedAt: new Date() } });
    const action = "loan.returned_to_review";
    const correlationId = randomUUID();
    const metadata = { loanId: loan.id, applicationId: loan.applicationId, reason };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: command.actorUserId, action, entityType: "Loan", entityId: loan.id, correlationId, metadata, eventHash } });
    return { applicationId: loan.applicationId };
  });
}

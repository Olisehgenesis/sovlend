import type { LoanApplicationStatus, LoanStatus, Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

import { canSelfApproveLoanApplication } from "./loan-application-access";

const CLOSED_LOAN_STATUSES = new Set<LoanStatus>(["ACTIVE", "IN_ARREARS", "OVERPAID", "WRITTEN_OFF", "CLOSED"]);

export class LoanDecisionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type DecisionLoan = {
  id: string;
  accountNumber: string;
  status: LoanStatus;
  disbursedOn: Date | null;
  principalMinor: bigint;
  denominationCurrency: string;
  principalWrittenOffMinor: bigint;
  charges: { status: string }[];
  _count: { transactions: number; installments: number; topUpLoans: number; reminders: number };
};

type DecisionApplication = {
  id: string;
  officeId: string;
  status: LoanApplicationStatus;
  submittedById: string | null;
  externalId: string | null;
  updatedAt: Date;
  proposedPrincipalMinor: bigint;
  product: { denominationCurrency: string };
  loan: DecisionLoan | null;
};

const applicationInclude = {
  product: { select: { denominationCurrency: true } },
  loan: {
    include: {
      charges: { select: { status: true } },
      _count: { select: { transactions: true, installments: true, topUpLoans: true, reminders: true } },
    },
  },
} satisfies Prisma.LoanApplicationInclude;

function historyBlock(application: DecisionApplication) {
  const loan = application.loan;
  if (application.status === "DISBURSED" || (loan && (loan.disbursedOn || CLOSED_LOAN_STATUSES.has(loan.status)))) {
    return "Disbursed loans stay on the record. Delete is only available before money moves.";
  }
  if (!loan) return null;
  if (loan.status !== "APPROVED" && loan.status !== "DRAFT") return "This loan cannot be deleted.";
  if (loan.principalWrittenOffMinor > 0n || loan._count.transactions || loan._count.installments || loan._count.topUpLoans || loan._count.reminders || loan.charges.some((charge) => charge.status !== "PENDING")) {
    return "This loan has financial history and cannot be deleted.";
  }
  return null;
}

async function actor(db: PrismaClient, scope: UserDataScope, actorUserId: string) {
  const user = await db.user.findUnique({
    where: { id: actorUserId },
    select: { systemRole: true, organizationId: true, banned: true },
  });
  if (!user || user.banned || user.organizationId !== scope.organizationId) return null;
  return user;
}

async function hasLoanPermission(db: PrismaClient, scope: UserDataScope, command: {
  actorUserId: string;
  officeId: string;
  permission: typeof permissions.loanApply | typeof permissions.loanApprove;
  amountMinor?: bigint;
  currencyCode?: string;
}) {
  return new AuthorizationService(db).isAllowed({
    actorUserId: command.actorUserId,
    permission: command.permission,
    organizationId: scope.organizationId,
    officeId: command.officeId,
    amountMinor: command.amountMinor,
    currencyCode: command.currencyCode,
  });
}

async function loadApplication(db: PrismaClient | Prisma.TransactionClient, scope: UserDataScope, applicationId: string) {
  return db.loanApplication.findFirst({
    where: { id: applicationId, office: { organizationId: scope.organizationId }, ...officeWhere(scope) },
    include: applicationInclude,
  });
}

export async function loanDecisionAvailability(db: PrismaClient, scope: UserDataScope, command: { applicationId: string; actorUserId: string }) {
  const application = await loadApplication(db, scope, command.applicationId);
  if (!application) return null;
  const user = await actor(db, scope, command.actorUserId);
  const manager = Boolean(user && canSelfApproveLoanApplication(user.systemRole));
  const amount = application.loan?.principalMinor ?? application.proposedPrincipalMinor;
  const currency = application.loan?.denominationCurrency ?? application.product.denominationCurrency;
  const canApprove = Boolean(user) && (manager || await hasLoanPermission(db, scope, {
    actorUserId: command.actorUserId, officeId: application.officeId, permission: permissions.loanApprove, amountMinor: amount, currencyCode: currency,
  }));
  const canApply = Boolean(user) && (manager || await hasLoanPermission(db, scope, {
    actorUserId: command.actorUserId, officeId: application.officeId, permission: permissions.loanApply,
  }));
  const blocked = historyBlock(application);
  const needsApprover = application.status === "APPROVED" || application.loan?.status === "APPROVED";
  return {
    canDelete: !blocked && (needsApprover ? canApprove : canApply),
    canReject: application.status === "SUBMITTED" && !application.loan && canApprove && (manager || application.submittedById !== command.actorUserId),
    updatedAt: application.updatedAt,
  };
}

function requireReason(reason: string) {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 1000) throw new LoanDecisionError("Provide a reason up to 1,000 characters", 400);
  return trimmed;
}

async function audit(tx: Prisma.TransactionClient, command: { actorUserId: string; action: string; entityId: string; metadata: Prisma.InputJsonObject }) {
  const correlationId = randomUUID();
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: command.action, metadata: command.metadata })).digest("hex");
  await tx.auditEvent.create({
    data: { actorId: command.actorUserId, action: command.action, entityType: "LoanApplication", entityId: command.entityId, correlationId, metadata: command.metadata, eventHash },
  });
}

export async function rejectLoanApplication(db: PrismaClient, scope: UserDataScope, command: {
  applicationId: string; actorUserId: string; reason: string; expectedUpdatedAt: Date;
}) {
  const reason = requireReason(command.reason);
  return db.$transaction(async (tx) => {
    const application = await loadApplication(tx, scope, command.applicationId);
    if (!application) throw new LoanDecisionError("Loan application not found", 404);
    if (application.status !== "SUBMITTED" || application.loan) throw new LoanDecisionError("Only a submitted application with no loan account can be rejected", 409);
    const user = await actor(db, scope, command.actorUserId);
    const manager = Boolean(user && canSelfApproveLoanApplication(user.systemRole));
    if (!user || (!manager && application.submittedById === command.actorUserId)) throw new PermissionDeniedError("You cannot reject this application");
    const allowed = manager || await hasLoanPermission(db, scope, {
      actorUserId: command.actorUserId,
      officeId: application.officeId,
      permission: permissions.loanApprove,
      amountMinor: application.proposedPrincipalMinor,
      currencyCode: application.product.denominationCurrency,
    });
    if (!allowed) throw new PermissionDeniedError("You cannot reject this application");
    const locked = await tx.loanApplication.updateMany({
      where: { id: application.id, status: "SUBMITTED", updatedAt: command.expectedUpdatedAt },
      data: { status: "REJECTED" },
    });
    if (locked.count !== 1) throw new LoanDecisionError("This application changed. Refresh and try again", 409);
    await tx.approval.create({ data: { applicationId: application.id, reviewerId: command.actorUserId, decision: "REJECTED", reason } });
    await audit(tx, { actorUserId: command.actorUserId, action: "loan.rejected", entityId: application.id, metadata: { applicationId: application.id, reason } });
    return { applicationId: application.id };
  });
}

export async function deleteLoanApplication(db: PrismaClient, scope: UserDataScope, command: {
  applicationId: string; actorUserId: string; reason: string; expectedUpdatedAt: Date;
}) {
  const reason = requireReason(command.reason);
  return db.$transaction(async (tx) => {
    const application = await loadApplication(tx, scope, command.applicationId);
    if (!application) throw new LoanDecisionError("Loan application not found", 404);
    const blocked = historyBlock(application);
    if (blocked) throw new LoanDecisionError(blocked, 409);
    const user = await actor(db, scope, command.actorUserId);
    const manager = Boolean(user && canSelfApproveLoanApplication(user.systemRole));
    const loan = application.loan;
    const needsApprover = application.status === "APPROVED" || loan?.status === "APPROVED";
    const allowed = Boolean(user) && (manager || await hasLoanPermission(db, scope, {
      actorUserId: command.actorUserId,
      officeId: application.officeId,
      permission: needsApprover ? permissions.loanApprove : permissions.loanApply,
      amountMinor: loan?.principalMinor ?? application.proposedPrincipalMinor,
      currencyCode: loan?.denominationCurrency ?? application.product.denominationCurrency,
    }));
    if (!allowed) throw new PermissionDeniedError("You cannot delete this loan");
    if (loan) {
      const journals = await tx.journal.count({ where: { referenceId: { in: [loan.id, application.id] } } });
      if (journals > 0) throw new LoanDecisionError("This loan has accounting entries and cannot be deleted", 409);
    }
    const locked = await tx.loanApplication.updateMany({
      where: { id: application.id, status: application.status, updatedAt: command.expectedUpdatedAt },
      data: { externalId: application.externalId },
    });
    if (locked.count !== 1) throw new LoanDecisionError("This application changed. Refresh and try again", 409);
    await audit(tx, {
      actorUserId: command.actorUserId,
      action: "loan.deleted",
      entityId: application.id,
      metadata: { applicationId: application.id, loanId: loan?.id ?? null, accountNumber: loan?.accountNumber ?? null, status: application.status, reason },
    });
    if (loan) {
      await tx.document.deleteMany({ where: { OR: [{ loanId: loan.id }, { collateral: { loanId: loan.id } }] } });
      await tx.charge.deleteMany({ where: { loanId: loan.id, status: "PENDING" } });
      await tx.loan.delete({ where: { id: loan.id } });
    }
    await tx.guarantorDocument.deleteMany({ where: { profile: { applicationId: application.id } } });
    await tx.guarantorProfile.deleteMany({ where: { applicationId: application.id } });
    await tx.approval.deleteMany({ where: { applicationId: application.id } });
    await tx.loanApplication.delete({ where: { id: application.id } });
    return { applicationId: application.id, loanId: loan?.id ?? null };
  });
}

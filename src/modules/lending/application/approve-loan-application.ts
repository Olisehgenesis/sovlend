import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";

export async function approveLoanApplication(
  prisma: PrismaClient,
  command: { applicationId: string; actorUserId: string; approvedPrincipalMinor: bigint; reason?: string },
) {
  const application = await prisma.loanApplication.findUnique({
    where: { id: command.applicationId },
    include: { client: { select: { organizationId: true, officeId: true } }, product: { select: { denominationCurrency: true, principalMinMinor: true, principalMaxMinor: true, annualRateBps: true, repaymentCount: true, repaymentFrequency: true, amortizationMethod: true, interestMethod: true, version: true } } },
  });
  if (!application) throw new Error("Loan application not found");
  if (application.status !== "SUBMITTED") throw new Error("Only submitted applications can be approved");
  if (application.submittedById === command.actorUserId) throw new Error("Maker-checker violation: submitter cannot approve this application");
  if (command.approvedPrincipalMinor <= 0n) throw new Error("Approved principal must be positive");
  if (command.approvedPrincipalMinor < application.product.principalMinMinor || command.approvedPrincipalMinor > application.product.principalMaxMinor) {
    throw new Error("Approved principal is outside the product range");
  }

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.loanApprove,
    organizationId: application.client.organizationId,
    officeId: application.client.officeId,
    amountMinor: command.approvedPrincipalMinor,
    currencyCode: application.product.denominationCurrency,
  });

  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.loanApplication.updateMany({
      where: { id: application.id, status: "SUBMITTED" },
      data: { status: "APPROVED", approvedPrincipalMinor: command.approvedPrincipalMinor, approvedAt: new Date() },
    });
    if (updated.count !== 1) throw new Error("Application was changed by another operation");

    await transaction.approval.create({ data: { applicationId: application.id, reviewerId: command.actorUserId, decision: "APPROVED", reason: command.reason } });
    const accountNumber = `LN-${application.id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    await transaction.loan.create({
      data: {
        applicationId: application.id,
        clientId: application.clientId,
        productId: application.productId,
        officeId: application.client.officeId,
        accountNumber,
        denominationCurrency: application.product.denominationCurrency,
        principalMinor: command.approvedPrincipalMinor,
        termsSnapshot: {
          productId: application.productId,
          denominationCurrency: application.product.denominationCurrency,
          principalMinMinor: application.product.principalMinMinor.toString(),
          principalMaxMinor: application.product.principalMaxMinor.toString(),
          annualRateBps: application.product.annualRateBps,
          repaymentCount: application.product.repaymentCount,
          repaymentFrequency: application.product.repaymentFrequency,
          amortizationMethod: application.product.amortizationMethod,
          interestMethod: application.product.interestMethod,
          productVersion: application.product.version,
        },
        status: "APPROVED",
      },
    });
    const correlationId = randomUUID();
    const metadata = { applicationId: application.id, accountNumber, approvedPrincipalMinor: command.approvedPrincipalMinor.toString() };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.application.approved", metadata })).digest("hex");
    await transaction.auditEvent.create({ data: { actorId: command.actorUserId, action: "loan.application.approved", entityType: "LoanApplication", entityId: application.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "LoanApplication", aggregateId: application.id, eventType: "loan.application.approved", payload: { applicationId: application.id, approvedPrincipalMinor: command.approvedPrincipalMinor.toString() } } });
    return transaction.loanApplication.findUniqueOrThrow({ where: { id: application.id } });
  });
}
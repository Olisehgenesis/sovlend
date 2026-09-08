import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { canSelfApproveLoanApplication } from "@/modules/lending/application/loan-application-access";
import { isLoanApplicationExpired } from "@/modules/lending/application/loan-application-expiry";
import { readChargeSnapshot, readCollateralSnapshot } from "@/modules/lending/application/loan-application-payload";
import { nextSubAccountNumber } from "@/modules/lending/domain/sub-account-numbering";

export async function approveLoanApplication(
  prisma: PrismaClient,
  command: { applicationId: string; actorUserId: string; approvedPrincipalMinor: bigint; reason?: string },
) {
  const application = await prisma.loanApplication.findUnique({
    where: { id: command.applicationId },
    include: {
      office: { select: { organizationId: true } },
      client: { select: { accountNumber: true } },
      group: { select: { accountNumber: true } },
      product: { select: { denominationCurrency: true, principalMinMinor: true, principalMaxMinor: true, annualRateBps: true, monitoringFeeAnnualRateBps: true, repaymentCount: true, repaymentFrequency: true, amortizationMethod: true, interestMethod: true, version: true } },
    },
  });
  if (!application) throw new Error("Loan application not found");
  if (application.status !== "SUBMITTED") throw new Error("Only submitted applications can be approved");
  if (isLoanApplicationExpired(application.applicationExpiresOn)) {
    throw new Error(`This application expired on ${application.applicationExpiresOn!.toISOString().slice(0, 10)} and can no longer be approved`);
  }
  if (application.submittedById === command.actorUserId) {
    const actor = await prisma.user.findUnique({ where: { id: command.actorUserId }, select: { systemRole: true } });
    const canSelfApprove = canSelfApproveLoanApplication(actor?.systemRole);
    if (!canSelfApprove) throw new Error("Maker-checker violation: submitter cannot approve this application");
  }
  if (command.approvedPrincipalMinor <= 0n) throw new Error("Approved principal must be positive");
  if (command.approvedPrincipalMinor < application.product.principalMinMinor || command.approvedPrincipalMinor > application.product.principalMaxMinor) {
    throw new Error("Approved principal is outside the product range");
  }

  await new AuthorizationService(prisma).assertAllowed({
    actorUserId: command.actorUserId,
    permission: permissions.loanApprove,
    organizationId: application.office.organizationId,
    officeId: application.officeId,
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
    // New loans open as a numbered sub-account of the borrower (client or group) instead of
    // an unrelated random code, e.g. client "000000926" -> first loan "000000926L", second "000000926L2".
    const baseAccountNumber = application.client?.accountNumber ?? application.group?.accountNumber;
    let accountNumber: string;
    if (baseAccountNumber) {
      const existingLoanCount = await transaction.loan.count({
        where: application.clientId ? { clientId: application.clientId } : { groupId: application.groupId! },
      });
      accountNumber = nextSubAccountNumber(baseAccountNumber, "L", existingLoanCount);
    } else {
      accountNumber = `LN-${application.id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    }
    // The applicant may have overridden term fields on the wizard's Terms step (nominal rate,
    // repayment count/frequency, amortization, etc.) — apply those on top of the product's
    // defaults so the created loan's schedule reflects what was actually reviewed and approved,
    // not just the raw product template.
    const termsOverride = (application.termsSnapshot ?? {}) as Record<string, unknown>;
    const loan = await transaction.loan.create({
      data: {
        applicationId: application.id,
        clientId: application.clientId,
        groupId: application.groupId,
        productId: application.productId,
        officeId: application.officeId,
        loanOfficerId: application.loanOfficerId,
        fundId: application.fundId,
        accountNumber,
        denominationCurrency: application.product.denominationCurrency,
        principalMinor: command.approvedPrincipalMinor,
        termsSnapshot: {
          productId: application.productId,
          denominationCurrency: application.product.denominationCurrency,
          principalMinMinor: application.product.principalMinMinor.toString(),
          principalMaxMinor: application.product.principalMaxMinor.toString(),
          annualRateBps: application.product.annualRateBps,
          monitoringFeeAnnualRateBps: application.product.monitoringFeeAnnualRateBps,
          repaymentCount: application.product.repaymentCount,
          repaymentFrequency: application.product.repaymentFrequency,
          amortizationMethod: application.product.amortizationMethod,
          interestMethod: application.product.interestMethod,
          productVersion: application.product.version,
          ...termsOverride,
        },
        status: "APPROVED",
      },
    });

    const chargeSelections = readChargeSnapshot(application.chargesSnapshot);
    if (chargeSelections.length > 0) {
      await transaction.charge.createMany({
        data: chargeSelections.map((selection) => ({
          clientId: application.clientId,
          groupId: application.groupId,
          loanId: loan.id,
          chargeDefinitionId: selection.chargeDefinitionId ?? null,
          name: selection.name,
          amountMinor: BigInt(selection.amountMinor),
          currencyCode: application.product.denominationCurrency,
        })),
      });
    }

    const collateralItems = readCollateralSnapshot(application.collateralSnapshot);
    if (collateralItems.length > 0) {
      await transaction.loanCollateral.createMany({
        data: collateralItems.map((item) => ({
          loanId: loan.id,
          type: item.type?.trim() || "Other",
          description: item.description?.trim() || null,
          estimatedValueMinor: item.estimatedValueMinor ? BigInt(item.estimatedValueMinor) : null,
          valuationCurrencyCode: application.product.denominationCurrency,
        })),
      });
    }

    const correlationId = randomUUID();
    const metadata = { applicationId: application.id, accountNumber, approvedPrincipalMinor: command.approvedPrincipalMinor.toString() };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.application.approved", metadata })).digest("hex");
    await transaction.auditEvent.create({ data: { actorId: command.actorUserId, action: "loan.application.approved", entityType: "LoanApplication", entityId: application.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "LoanApplication", aggregateId: application.id, eventType: "loan.application.approved", payload: { applicationId: application.id, approvedPrincipalMinor: command.approvedPrincipalMinor.toString() } } });
    return transaction.loanApplication.findUniqueOrThrow({ where: { id: application.id } });
  });
}
import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { canSelfApproveLoanApplication } from "@/modules/lending/application/loan-application-access";
import { readChargeSnapshot, readCollateralSnapshot } from "@/modules/lending/application/loan-application-payload";
import { nextSubAccountNumber } from "@/modules/lending/domain/sub-account-numbering";
import { isLoanLifExempt } from "@/modules/lending/domain/disbursement-payout";

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
      loan: { include: { collateralItems: { include: { _count: { select: { documents: true, notes: true } } } } } },
      product: { select: { denominationCurrency: true, principalMinMinor: true, principalMaxMinor: true, annualRateBps: true, monitoringFeeAnnualRateBps: true, processingFeeBps: true, repaymentCount: true, repaymentFrequency: true, amortizationMethod: true, interestMethod: true, version: true } },
    },
  });
  if (!application) throw new Error("Loan application not found");
  if (application.status !== "SUBMITTED") throw new Error("Only submitted applications can be approved");
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
      where: { id: application.id, status: "SUBMITTED", updatedAt: application.updatedAt },
      data: { status: "APPROVED", approvedPrincipalMinor: command.approvedPrincipalMinor, approvedAt: new Date() },
    });
    if (updated.count !== 1) throw new Error("Application was changed by another operation");

    await transaction.approval.create({ data: { applicationId: application.id, reviewerId: command.actorUserId, decision: "APPROVED", reason: command.reason } });
    // New loans open as a numbered sub-account of the borrower (client or group) instead of
    // an unrelated random code, e.g. client "000000926" -> first loan "000000926L", second "000000926L2".
    const existingLoan = application.loan;
    if (existingLoan && (existingLoan.status !== "DRAFT" || existingLoan.disbursedOn)) throw new Error("Only an undisbursed draft loan can be reapproved");
    const baseAccountNumber = application.client?.accountNumber ?? application.group?.accountNumber;
    let accountNumber: string;
    if (existingLoan) {
      accountNumber = existingLoan.accountNumber;
    } else if (baseAccountNumber) {
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
    const loanData = {
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
          processingFeeBps: application.product.processingFeeBps ?? 200,
          repaymentCount: application.product.repaymentCount,
          repaymentFrequency: application.product.repaymentFrequency,
          amortizationMethod: application.product.amortizationMethod,
          interestMethod: application.product.interestMethod,
          productVersion: application.product.version,
          ...termsOverride,
          ...(existingLoan ? { lifExempt: isLoanLifExempt(existingLoan.termsSnapshot) } : {}),
        },
        status: "APPROVED" as const,
    };
    let loan;
    if (existingLoan) {
      const changed = await transaction.loan.updateMany({
        where: { id: existingLoan.id, status: "DRAFT", disbursedOn: null, updatedAt: existingLoan.updatedAt },
        data: loanData,
      });
      if (changed.count !== 1) throw new Error("Draft loan changed. Refresh before approving");
      loan = { id: existingLoan.id };
      await transaction.charge.deleteMany({ where: { loanId: loan.id, status: "PENDING" } });
      await transaction.guarantor.deleteMany({ where: { loanId: loan.id } });
    } else {
      loan = await transaction.loan.create({ data: loanData });
    }

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
    if (existingLoan) {
      const retained = new Set<string>();
      for (const item of collateralItems) {
        const old = existingLoan.collateralItems.find(row => !retained.has(row.id) && row.type === (item.type?.trim() || "Other") && row.description === (item.description?.trim() || null));
        const data = { type: item.type?.trim() || "Other", description: item.description?.trim() || null, estimatedValueMinor: item.estimatedValueMinor ? BigInt(item.estimatedValueMinor) : null, valuationCurrencyCode: application.product.denominationCurrency };
        if (old) {
          retained.add(old.id);
          await transaction.loanCollateral.update({ where: { id: old.id }, data });
        } else {
          await transaction.loanCollateral.create({ data: { loanId: loan.id, ...data } });
        }
      }
      for (const old of existingLoan.collateralItems.filter(row => !retained.has(row.id))) {
        if (old._count.documents || old._count.notes) throw new Error("Collateral with documents or notes must be retained when reapproving the draft");
        await transaction.loanCollateral.delete({ where: { id: old.id } });
      }
    } else if (collateralItems.length > 0) {
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

    const guarantors = await transaction.guarantorProfile.findMany({ where: { applicationId: application.id } });
    if (guarantors.length > 0) {
      await transaction.guarantor.createMany({
        data: guarantors.map((guarantor) => ({
          firstName: guarantor.firstName, lastName: guarantor.lastName, phone: guarantor.phone,
          relationship: guarantor.relationship, profileId: guarantor.id,
          loanId: loan.id,
          guarantorType: guarantor.clientId ? "EXISTING_CLIENT" : "EXTERNAL",
          dateOfBirth: guarantor.dateOfBirth,
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
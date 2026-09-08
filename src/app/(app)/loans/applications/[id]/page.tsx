import { ShieldCheck } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplicationCollateralPanel, ApplicationDocumentsPanel, ApplicationNotesPanel } from "@/components/application-record-forms";
import { ApproveLoanForm } from "@/components/approve-loan-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DisburseLoanForm } from "@/components/disburse-loan-form";
import { EditLoanApplicationForm } from "@/components/edit-loan-application-form";
import { fromMinor } from "@/components/loan-application-form-shared";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { canEditSubmittedLoanApplication, canSelfApproveLoanApplication } from "@/modules/lending/application/loan-application-access";
import { isLoanApplicationExpired } from "@/modules/lending/application/loan-application-expiry";
import { readChargeSnapshot, readCollateralSnapshot, readTermsSnapshot } from "@/modules/lending/application/loan-application-payload";
import { formatMinor } from "@/modules/money/domain/format-minor";

function toDateInput(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function toPercentString(value: unknown) {
  return typeof value === "number" ? String(value / 100) : "";
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export default async function LoanApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const application = await prisma.loanApplication.findFirst({
    where: {
      id: (await params).id,
      office: { organizationId: scope.organizationId },
    },
    include: {
      client: { include: { office: true } },
      group: { select: { name: true, accountNumber: true } },
      office: { select: { name: true } },
      product: true,
      fund: { select: { name: true } },
      loan: true,
      loanOfficer: { select: { id: true, name: true } },
      submittedBy: { select: { id: true, name: true } },
      approvals: {
        include: { reviewer: { select: { name: true } } },
        orderBy: { decidedAt: "desc" },
      },
      documents: {
        include: { uploadedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      notes: {
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!application || (scope.officeIds && !scope.officeIds.includes(application.officeId))) notFound();

  const [settlementAccounts, savingsAccounts, actor, actorHasLoanApplyPermission] = await Promise.all([
    prisma.settlementAccount.findMany({
      where: { organizationId: scope.organizationId, currencyCode: application.product.denominationCurrency, active: true },
      select: { id: true, name: true, type: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    application.clientId
      ? prisma.savingsAccount.findMany({
          where: {
            clientId: application.clientId,
            status: "ACTIVE",
            currencyCode: application.product.denominationCurrency,
          },
          select: {
            id: true,
            accountNumber: true,
            isDefault: true,
            product: { select: { name: true } },
          },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { systemRole: true },
    }),
    new AuthorizationService(prisma).isAllowed({
      actorUserId: session.user.id,
      permission: permissions.loanApply,
      organizationId: scope.organizationId,
      officeId: application.officeId,
    }),
  ]);

  const proposed = formatMinor(application.proposedPrincipalMinor, application.product.denominationCurrency);
  const proposedInput = fromMinor(application.proposedPrincipalMinor);
  const displayedStatus = application.loan?.status ?? application.status;
  const actorApproved = application.approvals.some((approval) => approval.reviewerId === session.user.id);
  const actorCanSelfApprove = canSelfApproveLoanApplication(actor?.systemRole);
  const applicationExpired = isLoanApplicationExpired(application.applicationExpiresOn);
  const canManageEvidence = actorHasLoanApplyPermission;
  const canManageCollateral = canManageEvidence && application.status === "SUBMITTED";
  const canEditApplication =
    application.status === "SUBMITTED" &&
    actorHasLoanApplyPermission &&
    canEditSubmittedLoanApplication({
      actorUserId: session.user.id,
      actorSystemRole: actor?.systemRole,
      submittedById: application.submittedById,
    });

  const termsSnapshot = readTermsSnapshot(application.termsSnapshot);
  const chargeSelections = readChargeSnapshot(application.chargesSnapshot);
  const collateralSnapshot = readCollateralSnapshot(application.collateralSnapshot);
  const collateralItems = collateralSnapshot.map((item) => ({
    type: item.type,
    description: item.description,
    estimatedValueLabel: item.estimatedValueMinor ? formatMinor(BigInt(item.estimatedValueMinor), application.product.denominationCurrency) : undefined,
  }));
  const termValues = {
    annualRatePercent: toPercentString(termsSnapshot.annualRateBps) || String(application.product.annualRateBps / 100),
    monitoringFeeAnnualRatePercent: toPercentString(termsSnapshot.monitoringFeeAnnualRateBps) || String(application.product.monitoringFeeAnnualRateBps / 100),
    repaymentCount: typeof termsSnapshot.repaymentCount === "number" ? String(termsSnapshot.repaymentCount) : String(application.product.repaymentCount),
    repaymentFrequency: toStringValue(termsSnapshot.repaymentFrequency) || application.product.repaymentFrequency,
    interestMethod: toStringValue(termsSnapshot.interestMethod) || application.product.interestMethod,
    amortizationMethod: toStringValue(termsSnapshot.amortizationMethod) || application.product.amortizationMethod,
    firstRepaymentOn: toStringValue(termsSnapshot.firstRepaymentOn),
    arrearsTolerance: termsSnapshot.arrearsToleranceMinor ? fromMinor(termsSnapshot.arrearsToleranceMinor) : "",
  };

  const selectedChargeDefinitionIds = chargeSelections.map((charge) => charge.chargeDefinitionId).filter((id): id is string => Boolean(id));
  const editSupport = canEditApplication
    ? await Promise.all([
        prisma.user.findMany({
          where: {
            organizationId: scope.organizationId,
            systemRole: "LOAN_OFFICER",
            ...(application.loanOfficerId
              ? { OR: [{ officeId: application.officeId }, { id: application.loanOfficerId }] }
              : { officeId: application.officeId }),
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.chargeDefinition.findMany({
          where: {
            organizationId: scope.organizationId,
            appliesTo: "LOAN",
            ...(selectedChargeDefinitionIds.length > 0
              ? { OR: [{ active: true }, { id: { in: selectedChargeDefinitionIds } }] }
              : { active: true }),
          },
          orderBy: { name: "asc" },
        }),
        prisma.fund.findMany({
          where: {
            organizationId: scope.organizationId,
            ...(application.fundId
              ? { OR: [{ isActive: true }, { id: application.fundId }] }
              : { isActive: true }),
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : null;

  const chargesSummary =
    chargeSelections.length === 0
      ? "None"
      : chargeSelections
          .map((charge) => `${charge.name} (${formatMinor(BigInt(charge.amountMinor), application.product.denominationCurrency)})`)
          .join(", ");
  const collateralSummary =
    collateralSnapshot.length === 0
      ? "None"
      : collateralSnapshot.map((item) => item.type?.trim() || item.description?.trim() || "Collateral").join(", ");

  const actionPanel =
    application.status === "SUBMITTED" && applicationExpired ? (
      <article className="panel separation-note">
        <ShieldCheck size={26} />
        <strong>Application expired</strong>
        <p>
          This application expired on {application.applicationExpiresOn?.toLocaleDateString()}. It cannot be approved unless an authorized editor updates the expiry date.
        </p>
      </article>
    ) : application.status === "SUBMITTED" &&
    (application.submittedById !== session.user.id || actorCanSelfApprove) ? (
      <article className="panel">
        <ApproveLoanForm applicationId={application.id} proposedAmount={proposedInput} />
      </article>
    ) : application.status === "SUBMITTED" ? (
      <article className="panel separation-note">
        <ShieldCheck size={26} />
        <strong>Independent approval required</strong>
        <p>
          The person who submitted this application cannot approve it. Ask another authorized manager to review it.
        </p>
      </article>
    ) : application.status === "APPROVED" &&
      application.loan?.status === "APPROVED" &&
      application.submittedById !== session.user.id &&
      !actorApproved ? (
      <article className="panel">
        <DisburseLoanForm
          loanId={application.loan.id}
          savingsAccounts={savingsAccounts.map((account) => ({
            id: account.id,
            accountNumber: account.accountNumber,
            isDefault: account.isDefault,
            productName: account.product?.name ?? null,
          }))}
          settlementAccounts={settlementAccounts}
        />
      </article>
    ) : (
      <article className="panel separation-note">
        <CheckStatus status={application.loan?.status ?? application.status} reviewer={application.approvals[0]?.reviewer.name} />
      </article>
    );

  const availableOfficers = editSupport?.[0] ?? [];
  const availableCharges = editSupport?.[1] ?? [];
  const availableFunds = editSupport?.[2] ?? [];

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Loans", href: "/loans" },
          { label: "Applications", href: "/loans/applications" },
          { label: application.client ? `${application.client.firstName} ${application.client.lastName}` : `Group: ${application.group?.name ?? "Unknown"}` },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Maker-checker review</p>
          <h1>Loan application</h1>
          <p>
            {application.client ? `${application.client.firstName} ${application.client.lastName}` : `Group: ${application.group?.name ?? "Unknown"}`}{" "}
            · {application.client ? application.client.accountNumber : application.group?.accountNumber ?? ""}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/loans/applications">
            All applications
          </Link>
          {application.loan ? (
            <Link className="invest-button" href={`/loans/${application.loan.id}`}>
              Open loan account
            </Link>
          ) : null}
          <span
            className={`status status-prominent ${displayedStatus === "ACTIVE" || displayedStatus === "APPROVED" || displayedStatus === "DISBURSED" || displayedStatus === "OVERPAID" || displayedStatus === "CLOSED" ? "up-to-date" : displayedStatus === "IN_ARREARS" || displayedStatus === "REJECTED" || displayedStatus === "WRITTEN_OFF" ? "in-arrears" : "review"}`}
          >
            {displayedStatus}
          </span>
        </div>
      </header>
      <section className="review-grid">
        <article className="panel review-summary">
          <div className="panel-heading">
            <div>
              <h2>Application details</h2>
              <p>Submitted {application.submittedAt?.toLocaleString() ?? "Not submitted"}</p>
            </div>
            <ShieldCheck size={19} />
          </div>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{displayedStatus}</dd>
            </div>
            <div>
              <dt>Loan account</dt>
              <dd>{application.loan ? <Link className="green-link" href={`/loans/${application.loan.id}`}>{application.loan.accountNumber}</Link> : "Created after approval"}</dd>
            </div>
            <div>
              <dt>Office</dt>
              <dd>{application.office.name}</dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd>{application.product.name}</dd>
            </div>
            <div>
              <dt>Proposed principal</dt>
              <dd>{proposed}</dd>
            </div>
            <div>
              <dt>Product range</dt>
              <dd>{formatMinor(application.product.principalMinMinor, application.product.denominationCurrency)} – {formatMinor(application.product.principalMaxMinor, application.product.denominationCurrency)}</dd>
            </div>
            <div>
              <dt>Purpose</dt>
              <dd>{application.purpose ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Loan officer</dt>
              <dd>{application.loanOfficer?.name ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Fund</dt>
              <dd>{application.fund?.name ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Application expiry</dt>
              <dd>{application.applicationExpiresOn?.toLocaleDateString() ?? "Not set"}</dd>
            </div>
            <div>
              <dt>External ID</dt>
              <dd>{application.externalId ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Interest rate</dt>
              <dd>{termValues.annualRatePercent}% per year</dd>
            </div>
            <div>
              <dt>Monitoring fee</dt>
              <dd>{termValues.monitoringFeeAnnualRatePercent}% per year</dd>
            </div>
            <div>
              <dt>Repayments</dt>
              <dd>{termValues.repaymentCount} × {termValues.repaymentFrequency}</dd>
            </div>
            <div>
              <dt>Interest method</dt>
              <dd>{termValues.interestMethod}</dd>
            </div>
            <div>
              <dt>Amortization</dt>
              <dd>{termValues.amortizationMethod}</dd>
            </div>
            <div>
              <dt>First repayment</dt>
              <dd>{termValues.firstRepaymentOn || "Product schedule"}</dd>
            </div>
            <div>
              <dt>Arrears tolerance</dt>
              <dd>{termValues.arrearsTolerance ? formatMinor(BigInt(termsSnapshot.arrearsToleranceMinor ?? "0"), application.product.denominationCurrency) : "Product default"}</dd>
            </div>
            <div>
              <dt>Charges</dt>
              <dd>{chargesSummary}</dd>
            </div>
            <div>
              <dt>Collateral</dt>
              <dd>{collateralSummary}</dd>
            </div>
            <div>
              <dt>Approved at</dt>
              <dd>{application.approvedAt?.toLocaleString() ?? "Pending decision"}</dd>
            </div>
            <div>
              <dt>Submitted by</dt>
              <dd>{application.submittedBy?.name ?? "Unknown"}</dd>
            </div>
          </dl>
        </article>
        <div style={{ display: "grid", gap: 16 }}>
          {actionPanel}
          {canEditApplication ? (
            <EditLoanApplicationForm
              applicationId={application.id}
              borrowerLabel={application.client ? `${application.client.firstName} ${application.client.lastName} · ${application.client.accountNumber}` : `Group: ${application.group?.name ?? "Unknown"} · ${application.group?.accountNumber ?? ""}`}
              charges={availableCharges.map((charge) => ({
                id: charge.id,
                name: charge.name,
                calculationType: charge.calculationType,
                amountMinor: charge.amountMinor?.toString() ?? null,
                percentageBps: charge.percentageBps,
                currencyCode: charge.currencyCode,
              }))}
              funds={availableFunds}
              initialAmount={proposedInput}
              initialApplicationExpiresOn={toDateInput(application.applicationExpiresOn)}
              initialChargeIds={selectedChargeDefinitionIds}
              initialCollateral={collateralSnapshot.map((item) => ({
                type: item.type ?? "",
                description: item.description ?? "",
                estimatedValue: item.estimatedValueMinor ? fromMinor(item.estimatedValueMinor) : "",
              }))}
              initialExternalId={application.externalId ?? ""}
              initialFundId={application.fundId ?? ""}
              initialLoanOfficerId={application.loanOfficerId ?? ""}
              initialPurpose={application.purpose ?? ""}
              initialTerms={termValues}
              officers={availableOfficers}
              preservedCharges={chargeSelections.filter((charge) => !charge.chargeDefinitionId || !availableCharges.some((item) => item.id === charge.chargeDefinitionId))}
              product={{
                id: application.product.id,
                name: application.product.name,
                currency: application.product.denominationCurrency,
                minimum: formatMinor(application.product.principalMinMinor, application.product.denominationCurrency).replace(`${application.product.denominationCurrency} `, ""),
                maximum: formatMinor(application.product.principalMaxMinor, application.product.denominationCurrency).replace(`${application.product.denominationCurrency} `, ""),
                minimumMinor: application.product.principalMinMinor.toString(),
                maximumMinor: application.product.principalMaxMinor.toString(),
                annualRatePercent: application.product.annualRateBps / 100,
                monitoringFeeAnnualRatePercent: application.product.monitoringFeeAnnualRateBps / 100,
                repaymentCount: application.product.repaymentCount,
                repaymentFrequency: application.product.repaymentFrequency,
                interestMethod: application.product.interestMethod,
                amortizationMethod: application.product.amortizationMethod,
              }}
            />
          ) : null}
        </div>
      </section>
      <section className="review-grid">
        <article className="panel">
          <div className="panel-heading">
            <h2>Collateral</h2>
          </div>
          <ApplicationCollateralPanel
            applicationId={application.id}
            currency={application.product.denominationCurrency}
            items={collateralItems}
            canManage={canManageCollateral}
          />
        </article>
        <article className="panel">
          <div className="panel-heading">
            <h2>Documents</h2>
          </div>
          <ApplicationDocumentsPanel
            applicationId={application.id}
            canManage={canManageEvidence}
            documents={application.documents.map((document) => ({
              id: document.id,
              name: document.name,
              description: document.description,
              mediaType: document.mediaType,
              createdAtLabel: document.createdAt.toLocaleString(),
            }))}
          />
        </article>
      </section>
      <section className="review-grid">
        <article className="panel">
          <div className="panel-heading">
            <h2>Notes</h2>
          </div>
          <ApplicationNotesPanel
            applicationId={application.id}
            canManage={canManageEvidence}
            notes={application.notes.map((note) => ({
              id: note.id,
              body: note.body,
              authorName: note.author.name,
              createdAtLabel: note.createdAt.toLocaleString(),
            }))}
          />
        </article>
      </section>
    </main>
  );
}

function CheckStatus({
  status,
  reviewer,
}: {
  status: string;
  reviewer?: string;
}) {
  return (
    <>
      <ShieldCheck size={26} />
      <strong>Application {status.toLowerCase()}</strong>
      <p>{reviewer ? `Reviewed by ${reviewer}.` : "The review decision has been recorded."}</p>
    </>
  );
}

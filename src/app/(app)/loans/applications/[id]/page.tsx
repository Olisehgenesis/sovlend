import { ShieldCheck } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApproveLoanForm } from "@/components/approve-loan-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DisburseLoanForm } from "@/components/disburse-loan-form";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

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
      loan: true,
      submittedBy: { select: { id: true, name: true } },
      approvals: {
        include: { reviewer: { select: { name: true } } },
        orderBy: { decidedAt: "desc" },
      },
    },
  });
  if (
    !application ||
    (scope.officeIds && !scope.officeIds.includes(application.officeId))
  )
    notFound();
  const proposed = formatMinor(
    application.proposedPrincipalMinor,
    application.product.denominationCurrency,
  );
  const proposedInput = `${application.proposedPrincipalMinor / 100n}.${(application.proposedPrincipalMinor % 100n).toString().padStart(2, "0")}`;
  const settlementAccounts = await prisma.settlementAccount.findMany({
    where: { organizationId: scope.organizationId, currencyCode: application.product.denominationCurrency, active: true },
    select: { id: true, name: true, type: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  const actorApproved = application.approvals.some(
    (approval) => approval.reviewerId === session.user.id,
  );
  const displayedStatus = application.loan?.status ?? application.status;
  const actionPanel =
    application.status === "SUBMITTED" &&
    application.submittedById !== session.user.id ? (
      <article className="panel">
        <ApproveLoanForm
          applicationId={application.id}
          proposedAmount={proposedInput}
        />
      </article>
    ) : application.status === "SUBMITTED" ? (
      <article className="panel separation-note">
        <ShieldCheck size={26} />
        <strong>Independent approval required</strong>
        <p>
          The person who submitted this application cannot approve it. Ask
          another authorized manager to review it.
        </p>
      </article>
    ) : application.status === "APPROVED" &&
      application.loan?.status === "APPROVED" &&
      application.submittedById !== session.user.id &&
      !actorApproved ? (
      <article className="panel">
        <DisburseLoanForm
          loanId={application.loan.id}
          settlementAccounts={settlementAccounts}
        />
      </article>
    ) : (
      <article className="panel separation-note">
        <CheckStatus
          status={application.loan?.status ?? application.status}
          reviewer={application.approvals[0]?.reviewer.name}
        />
      </article>
    );
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
            {application.client
              ? `${application.client.firstName} ${application.client.lastName}`
              : `Group: ${application.group?.name ?? "Unknown"}`}{" "}
            ·{" "}
            {application.client ? application.client.accountNumber : (application.group?.accountNumber ?? "")}
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
              <p>
                Submitted{" "}
                {application.submittedAt?.toLocaleString() ?? "Not submitted"}
              </p>
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
              <dd>
                {application.loan ? <Link className="green-link" href={`/loans/${application.loan.id}`}>{application.loan.accountNumber}</Link> : "Created after approval"}
              </dd>
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
              <dd>
                {formatMinor(
                  application.product.principalMinMinor,
                  application.product.denominationCurrency,
                )}{" "}
                –{" "}
                {formatMinor(
                  application.product.principalMaxMinor,
                  application.product.denominationCurrency,
                )}
              </dd>
            </div>
            <div>
              <dt>Purpose</dt>
              <dd>{application.purpose ?? "Not provided"}</dd>
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
        {actionPanel}
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
      <p>
        {reviewer
          ? `Reviewed by ${reviewer}.`
          : "The review decision has been recorded."}
      </p>
    </>
  );
}

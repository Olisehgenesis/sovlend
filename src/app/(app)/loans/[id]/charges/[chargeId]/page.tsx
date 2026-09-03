import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { formatMinor } from "@/modules/money/domain/format-minor";

import {
  formatUgDate,
  formatUgDateTime,
  getLoanBorrowerAccount,
  getLoanBorrowerLabel,
  getLoanRouteContext,
} from "../../_lib/loan-records";

export default async function LoanChargePage({
  params,
}: {
  params: Promise<{ id: string; chargeId: string }>;
}) {
  const { id, chargeId } = await params;
  const { loan } = await getLoanRouteContext(id);

  const charge = await prisma.charge.findFirst({
    where: { id: chargeId, loanId: loan.id },
    include: {
      chargeDefinition: {
        select: { name: true, appliesTo: true, penalty: true },
      },
    },
  });

  if (!charge) notFound();

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Loans", href: "/loans" },
          { label: loan.accountNumber, href: `/loans/${loan.id}?tab=charges` },
          { label: "Charges", href: `/loans/${loan.id}?tab=charges` },
          { label: charge.name },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Loan charge</p>
          <h1>{charge.name}</h1>
          <p>
            {getLoanBorrowerLabel(loan)} · {loan.product.name}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href={`/loans/${loan.id}?tab=charges`}>
            Back to charges
          </Link>
        </div>
      </header>
      <section className="panel review-summary">
        <div className="panel-heading">
          <div>
            <h2>Charge details</h2>
            <p>Full record for this loan fee or penalty.</p>
          </div>
          <span
            className={`status status-prominent ${charge.status === "PAID" ? "up-to-date" : charge.status === "WAIVED" ? "review" : "in-arrears"}`}
          >
            {charge.status}
          </span>
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Loan account</dt>
            <dd>{loan.accountNumber}</dd>
          </div>
          <div>
            <dt>Borrower</dt>
            <dd>
              {getLoanBorrowerLabel(loan)} · {getLoanBorrowerAccount(loan)}
            </dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{formatMinor(charge.amountMinor, charge.currencyCode)}</dd>
          </div>
          <div>
            <dt>Due date</dt>
            <dd>{formatUgDate(charge.dueOn)}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{charge.chargeDefinition?.penalty ? "Penalty" : "Charge"}</dd>
          </div>
          <div>
            <dt>Definition</dt>
            <dd>{charge.chargeDefinition?.name ?? "Manual loan charge"}</dd>
          </div>
          <div>
            <dt>Applies to</dt>
            <dd>{charge.chargeDefinition?.appliesTo ?? "LOAN"}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>{formatUgDateTime(charge.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatUgDateTime(charge.updatedAt)}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

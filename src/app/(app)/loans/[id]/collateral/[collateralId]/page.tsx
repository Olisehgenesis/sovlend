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
  isRecord,
} from "../../_lib/loan-records";

export default async function LoanCollateralPage({
  params,
}: {
  params: Promise<{ id: string; collateralId: string }>;
}) {
  const { id, collateralId } = await params;
  const { loan } = await getLoanRouteContext(id);

  const collateral = await prisma.loanCollateral.findFirst({
    where: { id: collateralId, loanId: loan.id },
  });

  if (!collateral) notFound();

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Loans", href: "/loans" },
          { label: loan.accountNumber, href: `/loans/${loan.id}?tab=collateral` },
          { label: "Collateral", href: `/loans/${loan.id}?tab=collateral` },
          { label: collateral.type },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Loan collateral</p>
          <h1>{collateral.type}</h1>
          <p>
            {getLoanBorrowerLabel(loan)} · {loan.product.name}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href={`/loans/${loan.id}?tab=collateral`}>
            Back to collateral
          </Link>
        </div>
      </header>
      <section className="panel review-summary">
        <div className="panel-heading">
          <div>
            <h2>Collateral details</h2>
            <p>Security pledged against {loan.accountNumber}.</p>
          </div>
          <span
            className={`status status-prominent ${collateral.status === "ACTIVE" ? "up-to-date" : "review"}`}
          >
            {collateral.status}
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
            <dt>Description</dt>
            <dd>{collateral.description ?? "No additional description"}</dd>
          </div>
          <div>
            <dt>Estimated value</dt>
            <dd>
              {collateral.estimatedValueMinor
                ? formatMinor(
                    collateral.estimatedValueMinor,
                    collateral.valuationCurrencyCode,
                  )
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Valuation date</dt>
            <dd>{formatUgDate(collateral.valuationDate)}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{collateral.valuationCurrencyCode}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>{formatUgDateTime(collateral.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatUgDateTime(collateral.updatedAt)}</dd>
          </div>
        </dl>
      </section>
      {isRecord(collateral.metadata) ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Metadata</h2>
              <p>Additional structured information captured for this item.</p>
            </div>
          </div>
          <pre style={{ margin: 0, padding: "18px", overflowX: "auto" }}>
            {JSON.stringify(collateral.metadata, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}

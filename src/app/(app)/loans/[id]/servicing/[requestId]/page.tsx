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

const actionLabels: Record<string, string> = {
  FORECLOSURE: "Foreclosure",
  PREPAY: "Prepay loan",
  TRANSACTION_REVERSAL: "Reverse transaction",
  UNDO_DISBURSAL: "Undo disbursal",
};

export default async function LoanServiceRequestPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  const { loan, scope } = await getLoanRouteContext(id);

  const request = await prisma.loanServiceRequest.findFirst({
    where: { id: requestId, loanId: loan.id },
    include: {
      decidedBy: { select: { name: true } },
      requestedBy: { select: { name: true } },
      resultTransaction: {
        select: {
          id: true,
          businessDate: true,
          denominationAmountMinor: true,
          transactionType: true,
        },
      },
    },
  });

  if (!request) notFound();

  const payload = isRecord(request.payload) ? request.payload : null;
  const businessDate = typeof payload?.businessDate === "string" ? payload.businessDate : null;
  const waivePenalties =
    typeof payload?.waivePenalties === "boolean" ? payload.waivePenalties : null;
  const targetTransactionId =
    typeof payload?.transactionId === "string" ? payload.transactionId : null;
  const settlementAccountId =
    typeof payload?.settlementAccountId === "string"
      ? payload.settlementAccountId
      : null;

  const [targetTransaction, settlementAccount] = await Promise.all([
    targetTransactionId
      ? prisma.loanTransaction.findFirst({
          where: { id: targetTransactionId, loanId: loan.id },
          select: {
            id: true,
            businessDate: true,
            denominationAmountMinor: true,
            transactionType: true,
          },
        })
      : null,
    settlementAccountId
      ? prisma.settlementAccount.findFirst({
          where: {
            id: settlementAccountId,
            organizationId: scope.organizationId,
          },
          select: { name: true, type: true },
        })
      : null,
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Loans", href: "/loans" },
          { label: loan.accountNumber, href: `/loans/${loan.id}?tab=servicing` },
          { label: "Servicing", href: `/loans/${loan.id}?tab=servicing` },
          { label: actionLabels[request.actionType] ?? request.actionType },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Servicing request</p>
          <h1>{actionLabels[request.actionType] ?? request.actionType}</h1>
          <p>
            {getLoanBorrowerLabel(loan)} · {loan.product.name}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href={`/loans/${loan.id}?tab=servicing`}>
            Back to servicing
          </Link>
          {request.resultTransaction ? (
            <Link
              className="invest-button"
              href={`/loans/${loan.id}/transactions/${request.resultTransaction.id}`}
            >
              Open resulting transaction
            </Link>
          ) : null}
        </div>
      </header>
      <section className="panel review-summary">
        <div className="panel-heading">
          <div>
            <h2>Request details</h2>
            <p>Maker-checker audit trail for this high-risk action.</p>
          </div>
          <span
            className={`status status-prominent ${request.status === "APPROVED" ? "up-to-date" : request.status === "REJECTED" ? "in-arrears" : "review"}`}
          >
            {request.status}
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
            <dt>Requested by</dt>
            <dd>{request.requestedBy.name}</dd>
          </div>
          <div>
            <dt>Requested at</dt>
            <dd>{formatUgDateTime(request.requestedAt)}</dd>
          </div>
          <div>
            <dt>Business date</dt>
            <dd>{formatUgDate(businessDate)}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>{request.reason ?? "—"}</dd>
          </div>
          <div>
            <dt>Settlement account</dt>
            <dd>
              {settlementAccount
                ? `${settlementAccount.name} · ${settlementAccount.type.replaceAll("_", " ")}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Waive penalties</dt>
            <dd>
              {waivePenalties === null ? "—" : waivePenalties ? "Yes" : "No"}
            </dd>
          </div>
          <div>
            <dt>Decision by</dt>
            <dd>{request.decidedBy?.name ?? "Pending"}</dd>
          </div>
          <div>
            <dt>Decision time</dt>
            <dd>{formatUgDateTime(request.decidedAt)}</dd>
          </div>
          <div>
            <dt>Decision note</dt>
            <dd>{request.decisionNote ?? "—"}</dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd>
              {request.resultTransaction ? (
                <Link
                  className="green-link"
                  href={`/loans/${loan.id}/transactions/${request.resultTransaction.id}`}
                >
                  {request.resultTransaction.transactionType.replaceAll("_", " ")} · {formatMinor(request.resultTransaction.denominationAmountMinor, loan.denominationCurrency)}
                </Link>
              ) : (
                "No transaction posted"
              )}
            </dd>
          </div>
          <div>
            <dt>Target transaction</dt>
            <dd>
              {targetTransaction ? (
                <Link
                  className="green-link"
                  href={`/loans/${loan.id}/transactions/${targetTransaction.id}`}
                >
                  {targetTransaction.transactionType.replaceAll("_", " ")} · {formatMinor(targetTransaction.denominationAmountMinor, loan.denominationCurrency)}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </section>
      {payload ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Payload snapshot</h2>
              <p>Underlying request payload stored for audit.</p>
            </div>
          </div>
          <pre style={{ margin: 0, padding: "18px", overflowX: "auto" }}>
            {JSON.stringify(payload, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}

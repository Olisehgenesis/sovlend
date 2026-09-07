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

export default async function LoanTransactionPage({
  params,
}: {
  params: Promise<{ id: string; transactionId: string }>;
}) {
  const { id, transactionId } = await params;
  const { loan } = await getLoanRouteContext(id);

  const transaction = await prisma.loanTransaction.findFirst({
    where: { id: transactionId, loanId: loan.id },
    include: {
      allocations: {
        include: {
          installment: {
            select: { id: true, installmentNumber: true, dueOn: true },
          },
        },
        orderBy: { installment: { installmentNumber: "asc" } },
      },
      reversedBy: {
        select: { id: true, businessDate: true, transactionType: true },
      },
      reverses: {
        select: { id: true, businessDate: true, transactionType: true },
      },
      serviceRequest: {
        select: { id: true, actionType: true, status: true },
      },
      settlementAccount: {
        select: { name: true, type: true },
      },
    },
  });

  if (!transaction) notFound();

  const allocatedTotal = transaction.allocations.reduce(
    (sum, allocation) =>
      sum +
      allocation.principalMinor +
      allocation.interestMinor +
      allocation.feesMinor +
      allocation.penaltiesMinor,
    0n,
  );

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Loans", href: "/loans" },
          { label: loan.accountNumber, href: `/loans/${loan.id}` },
          { label: "Transactions", href: `/loans/${loan.id}` },
          { label: transaction.transactionType.replaceAll("_", " ") },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Loan transaction</p>
          <h1>{transaction.transactionType.replaceAll("_", " ")}</h1>
          <p>
            {getLoanBorrowerLabel(loan)} · {formatUgDate(transaction.businessDate)}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href={`/loans/${loan.id}`}>
            Back to schedule
          </Link>
          {transaction.serviceRequest ? (
            <Link
              className="invest-button"
              href={`/loans/${loan.id}/servicing/${transaction.serviceRequest.id}`}
            >
              Open service request
            </Link>
          ) : null}
        </div>
      </header>
      <section className="panel review-summary">
        <div className="panel-heading">
          <div>
            <h2>Transaction details</h2>
            <p>Immutable record of money movement on this loan.</p>
          </div>
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
            <dt>Business date</dt>
            <dd>{formatUgDate(transaction.businessDate)}</dd>
          </div>
          <div>
            <dt>Recorded at</dt>
            <dd>{formatUgDateTime(transaction.createdAt)}</dd>
          </div>
          <div>
            <dt>Settlement channel</dt>
            <dd>{transaction.settlementChannel}</dd>
          </div>
          <div>
            <dt>Settlement account</dt>
            <dd>
              {transaction.settlementAccount
                ? `${transaction.settlementAccount.name} · ${transaction.settlementAccount.type.replaceAll("_", " ")}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Settlement amount</dt>
            <dd>
              {formatMinor(
                transaction.settlementAmountMinor,
                transaction.settlementCurrency,
              )}
            </dd>
          </div>
          <div>
            <dt>Loan currency amount</dt>
            <dd>
              {formatMinor(
                transaction.denominationAmountMinor,
                loan.denominationCurrency,
              )}
            </dd>
          </div>
          <div>
            <dt>External reference</dt>
            <dd>{transaction.externalReference ?? "—"}</dd>
          </div>
          <div>
            <dt>Allocated total</dt>
            <dd>{formatMinor(allocatedTotal, loan.denominationCurrency)}</dd>
          </div>
          <div>
            <dt>Reversal of</dt>
            <dd>
              {transaction.reverses ? (
                <Link className="green-link" href={`/loans/${loan.id}/transactions/${transaction.reverses.id}`}>
                  {transaction.reverses.transactionType.replaceAll("_", " ")} · {formatUgDate(transaction.reverses.businessDate)}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Reversed by</dt>
            <dd>
              {transaction.reversedBy ? (
                <Link className="green-link" href={`/loans/${loan.id}/transactions/${transaction.reversedBy.id}`}>
                  {transaction.reversedBy.transactionType.replaceAll("_", " ")} · {formatUgDate(transaction.reversedBy.businessDate)}
                </Link>
              ) : (
                "Not reversed"
              )}
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Installment allocations</h2>
            <p>How this transaction was applied across the schedule.</p>
          </div>
        </div>
        {transaction.allocations.length === 0 ? (
          <div className="empty-state compact-empty">
            <strong>No allocations recorded</strong>
            <p>This transaction is not applied to individual installments.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Installment</th>
                  <th>Due date</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Fees</th>
                  <th>Penalties</th>
                </tr>
              </thead>
              <tbody>
                {transaction.allocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td>{allocation.installment.installmentNumber}</td>
                    <td>{formatUgDate(allocation.installment.dueOn)}</td>
                    <td>{formatMinor(allocation.principalMinor, loan.denominationCurrency)}</td>
                    <td>{formatMinor(allocation.interestMinor, loan.denominationCurrency)}</td>
                    <td>{formatMinor(allocation.feesMinor, loan.denominationCurrency)}</td>
                    <td>{formatMinor(allocation.penaltiesMinor, loan.denominationCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

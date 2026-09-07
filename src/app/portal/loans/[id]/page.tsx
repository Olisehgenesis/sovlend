import { CircleDollarSign } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMinor } from "@/modules/money/domain/format-minor";
import {
  installmentOutstandingMinor,
  installmentWaivedMinor,
  loanOutstandingMinor,
  loanWrittenOffMinor,
} from "@/modules/lending/domain/loan-outstanding";

import { getPortalClient } from "../../_lib/portal-context";

function loanStatusTone(status: string) {
  switch (status) {
    case "ACTIVE":
    case "OVERPAID":
    case "CLOSED":
      return "up-to-date";
    case "IN_ARREARS":
    case "WRITTEN_OFF":
      return "in-arrears";
    default:
      return "review";
  }
}

export default async function PortalLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { client } = await getPortalClient();
  const { id } = await params;
  const { prisma } = await import("@/lib/prisma");

  const loan = await prisma.loan.findFirst({
    where: { id, clientId: client.id },
    include: {
      product: true,
      installments: { orderBy: { installmentNumber: "asc" } },
      transactions: { orderBy: { businessDate: "desc" }, take: 25 },
    },
  });
  if (!loan) notFound();

  const totals = loan.installments.reduce(
    (sum, item) => ({
      due: sum.due + item.principalDueMinor + item.interestDueMinor + item.feesDueMinor + item.penaltiesDueMinor,
      paid: sum.paid + item.principalPaidMinor + item.interestPaidMinor + item.feesPaidMinor + item.penaltiesPaidMinor,
      waived: sum.waived + installmentWaivedMinor(item),
    }),
    { due: 0n, paid: 0n, waived: 0n },
  );
  const writtenOff = loanWrittenOffMinor(loan);
  const outstanding = loanOutstandingMinor(loan.installments, loan);

  return (
    <div className="directory-page portal-page">
      <header className="directory-header">
        <div>
          <p className="eyebrow">Loan account</p>
          <h1>{loan.accountNumber}</h1>
          <p>{loan.product.name}</p>
        </div>
        <div className="header-actions">
          <span className={`status status-prominent ${loanStatusTone(loan.status)}`}>{loan.status.replaceAll("_", " ")}</span>
          <Link className="secondary-action" href="/portal">
            Back
          </Link>
        </div>
      </header>

      <section className="loan-summary-metrics">
        <article>
          <span>Principal</span>
          <strong>{formatMinor(loan.principalMinor, loan.denominationCurrency)}</strong>
        </article>
        <article>
          <span>Total scheduled</span>
          <strong>{formatMinor(totals.due, loan.denominationCurrency)}</strong>
        </article>
        <article>
          <span>Total paid</span>
          <strong>{formatMinor(totals.paid, loan.denominationCurrency)}</strong>
        </article>
        <article>
          <span>Outstanding</span>
          <strong>{formatMinor(outstanding, loan.denominationCurrency)}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Repayment schedule</h2>
            <p>
              {loan.installments.length} installments · matures {loan.maturesOn?.toLocaleDateString() ?? "not set"}
            </p>
          </div>
        </div>
        {loan.installments.length === 0 ? (
          <div className="empty-state compact-empty">
            <CircleDollarSign size={26} />
            <strong>No schedule yet</strong>
            <p>The schedule is created at disbursement.</p>
          </div>
        ) : (
          <div className="table-scroll table-scroll-capped">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Due</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Fees</th>
                  <th>Penalties</th>
                  <th>Paid</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {loan.installments.map((item) => {
                  const paid = item.principalPaidMinor + item.interestPaidMinor + item.feesPaidMinor + item.penaltiesPaidMinor;
                  const rowOutstanding = installmentOutstandingMinor(item);
                  return (
                    <tr key={item.id}>
                      <td>{item.installmentNumber}</td>
                      <td>{item.dueOn.toLocaleDateString()}</td>
                      <td>{formatMinor(item.principalDueMinor, loan.denominationCurrency)}</td>
                      <td>{formatMinor(item.interestDueMinor, loan.denominationCurrency)}</td>
                      <td>{formatMinor(item.feesDueMinor, loan.denominationCurrency)}</td>
                      <td>{formatMinor(item.penaltiesDueMinor, loan.denominationCurrency)}</td>
                      <td>{formatMinor(paid, loan.denominationCurrency)}</td>
                      <td>{formatMinor(rowOutstanding, loan.denominationCurrency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent transactions</h2>
            <p>Most recent 25 · immutable account activity</p>
          </div>
        </div>
        {loan.transactions.length === 0 ? (
          <div className="empty-state compact-empty">
            <CircleDollarSign size={26} />
            <strong>No transactions</strong>
          </div>
        ) : (
          <div className="table-scroll table-scroll-capped">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {loan.transactions.map((item) => (
                  <tr key={item.id}>
                    <td>{item.businessDate.toLocaleDateString()}</td>
                    <td>{item.transactionType.replaceAll("_", " ")}</td>
                    <td>{formatMinor(item.denominationAmountMinor, loan.denominationCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

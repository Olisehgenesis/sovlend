import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalIcon } from "@/components/portal/portal-icon";
import { isLoanPaymentTransaction, transactionTypeLabel, transactionTypeVariants } from "@/lib/loan-transaction-type-variants";
import { prisma } from "@/lib/prisma";
import { formatMinor } from "@/modules/money/domain/format-minor";
import {
  installmentOutstandingMinor,
  installmentPaidMinor,
  installmentsWithCharges,
  loanOutstandingMinor,
} from "@/modules/lending/domain/loan-outstanding";

import { getPortalClient } from "../../_lib/portal-context";

const disbursementTypes = new Set(transactionTypeVariants("DISBURSEMENT"));
const dueFormat = new Intl.DateTimeFormat("en-UG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Kampala" });

function plainStatus(status: string) {
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function loanTone(type: string) {
  if (disbursementTypes.has(type)) return "in";
  if (isLoanPaymentTransaction(type)) return "out";
  return "note";
}

export default async function PortalLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { client } = await getPortalClient();
  const { id } = await params;

  const loan = await prisma.loan.findFirst({
    where: { id, clientId: client.id },
    include: {
      product: true,
      installments: { orderBy: { installmentNumber: "asc" } },
      charges: { select: { name: true, amountMinor: true, status: true, dueOn: true } },
      transactions: { orderBy: { businessDate: "desc" }, take: 40 },
    },
  });
  if (!loan) notFound();

  const schedule = installmentsWithCharges(loan.installments, loan.charges);
  const outstanding = loanOutstandingMinor(schedule, loan);

  return (
    <div className="portal-detail">
      <Link className="portal-back" href="/portal">
        Back
      </Link>
      <header className="portal-hello">
        <p>{loan.product.name}</p>
        <h1>{loan.accountNumber}</h1>
        <small>{plainStatus(loan.status)}</small>
      </header>
      <section className="portal-card" aria-label="Loan balance">
        <span>To repay</span>
        <strong>{formatMinor(outstanding, loan.denominationCurrency)}</strong>
        <div className="portal-card-row">
          <span className="portal-chip">Borrowed {formatMinor(loan.principalMinor, loan.denominationCurrency)}</span>
          {loan.maturesOn ? <span className="portal-chip">Matures {dueFormat.format(loan.maturesOn)}</span> : null}
        </div>
      </section>

      <section className="portal-schedule" aria-labelledby="loan-schedule">
        <h2 id="loan-schedule">Repayment schedule</h2>
        {schedule.length === 0 ? (
          <p className="portal-empty">
            <strong>No schedule yet</strong>
            The schedule is created when the loan is disbursed.
          </p>
        ) : (
          <ol>
            {schedule.map((item) => {
              const rowOutstanding = installmentOutstandingMinor(item);
              const paid = installmentPaidMinor(item);
              return (
                <li key={item.id} data-open={rowOutstanding > 0n ? "true" : "false"}>
                  <span>{item.installmentNumber}</span>
                  <span>
                    <strong>{dueFormat.format(item.dueOn)}</strong>
                    <small>Paid {formatMinor(paid, loan.denominationCurrency)}</small>
                  </span>
                  <b>{formatMinor(rowOutstanding, loan.denominationCurrency)}</b>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="portal-feed" aria-labelledby="loan-activity">
        <div className="portal-feed-head">
          <h2 id="loan-activity">Transactions</h2>
        </div>
        {loan.transactions.length === 0 ? (
          <p className="portal-empty">
            <strong>No transactions</strong>
            Disbursements and repayments will show up here.
          </p>
        ) : (
          <ul className="portal-feed-list">
            {loan.transactions.map((item) => {
              const tone = loanTone(item.transactionType);
              const title = transactionTypeLabel(item.transactionType);
              const amount = item.denominationAmountMinor < 0n ? -item.denominationAmountMinor : item.denominationAmountMinor;
              return (
                <li key={item.id}>
                  <div>
                    <PortalIcon seed={title} />
                    <span>
                      <strong>{title}</strong>
                      <small>{dueFormat.format(item.businessDate)}</small>
                    </span>
                    <b className={`portal-amount ${tone}`}>
                      {tone === "in" ? "+" : tone === "out" ? "−" : ""}
                      {formatMinor(amount, loan.denominationCurrency)}
                    </b>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

import type { LoanStatus } from "@prisma/client";
import { CircleDollarSign } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

export default async function LoansDisbursedTodayPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const userScope = await getUserDataScope(prisma, session.user.id);
  if (!userScope) redirect("/");

  const now = new Date();
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const transactions = await prisma.loanTransaction.findMany({
    where: {
      businessDate: { gte: today, lt: tomorrow },
      transactionType: "DISBURSEMENT",
      loan: {
        office: { organizationId: userScope.organizationId },
        ...officeWhere(userScope),
      },
    },
    select: {
      id: true,
      denominationAmountMinor: true,
      settlementChannel: true,
      externalReference: true,
      reversedById: true,
      loan: {
        select: {
          id: true,
          accountNumber: true,
          status: true,
          denominationCurrency: true,
          office: { select: { name: true } },
          product: { select: { name: true } },
          client: { select: { firstName: true, middleName: true, lastName: true } },
          group: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalDisbursedMinor = transactions.reduce((sum, transaction) => sum + transaction.denominationAmountMinor, 0n);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Loans", href: "/loans" }, { label: "Disbursed today" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Daily disbursements</p>
          <h1>Loans disbursed today</h1>
          <p>
            {transactions.length.toLocaleString()} disbursement transactions · {formatMinor(totalDisbursedMinor, "UGX")} released today
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/">
            Overview
          </Link>
          <Link className="secondary-action" href="/loans">
            All loans
          </Link>
        </div>
      </header>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Disbursement transactions</h2>
            <p>Principal released to borrowers in your current office scope today</p>
          </div>
          <CircleDollarSign size={19} />
        </div>
        {transactions.length === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No loans disbursed today</strong>
            <p>No disbursement transactions have been recorded in your current office scope today.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>Product</th>
                  <th>Office</th>
                  <th>Channel</th>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Loan status</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>
                      <strong>{borrowerLabel(transaction.loan.client, transaction.loan.group)}</strong>
                      <small className="mono">{transaction.loan.accountNumber}</small>
                      <Link className="row-link" href={`/loans/${transaction.loan.id}`} aria-label={`Open ${transaction.loan.accountNumber}`} />
                    </td>
                    <td>{transaction.loan.product.name}</td>
                    <td>{transaction.loan.office.name}</td>
                    <td>{transaction.settlementChannel}</td>
                    <td>{transaction.externalReference ?? "—"}</td>
                    <td>{formatMinor(transaction.denominationAmountMinor, transaction.loan.denominationCurrency)}</td>
                    <td>
                      <span className={`status ${loanStatusTone(transaction.loan.status)}`}>
                        {transaction.loan.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>
                      <span className={`status ${transaction.reversedById ? "review" : "up-to-date"}`}>
                        {transaction.reversedById ? "Reversed" : "Recorded"}
                      </span>
                    </td>
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

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function borrowerLabel(
  client: { firstName: string; middleName: string | null; lastName: string } | null,
  group: { name: string } | null,
) {
  return client
    ? [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ")
    : `Group: ${group?.name ?? "Unknown"}`;
}

function loanStatusTone(status: LoanStatus) {
  switch (status) {
    case "ACTIVE":
    case "CLOSED":
      return "up-to-date";
    case "IN_ARREARS":
    case "WRITTEN_OFF":
      return "in-arrears";
    default:
      return "review";
  }
}

import { PiggyBank } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMinor } from "@/modules/money/domain/format-minor";

import { getPortalClient } from "../../_lib/portal-context";

function savingsStatusTone(status: string) {
  return status === "ACTIVE" ? "up-to-date" : "review";
}

// `Date.toLocaleDateString()` uses the server/browser default locale, which renders as
// ambiguous M/D/YYYY (e.g. "7/13/2026"). Use an explicit "13 Jul 2026, 10:32"-style format
// instead, matching the loan detail page.
const portalDateTimeFormatter = new Intl.DateTimeFormat("en-UG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Kampala",
});

export default async function PortalSavingsAccountPage({ params }: { params: Promise<{ accountNumber: string }> }) {
  const { client } = await getPortalClient();
  const { accountNumber } = await params;
  const { prisma } = await import("@/lib/prisma");

  const account = await prisma.savingsAccount.findFirst({
    where: { accountNumber, clientId: client.id },
    include: {
      product: true,
      transactions: { orderBy: { createdAt: "desc" }, take: 25 },
    },
  });
  if (!account) notFound();

  const balanceMinor = account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);

  return (
    <div className="directory-page portal-page">
      <header className="directory-header">
        <div>
          <p className="eyebrow">Savings account</p>
          <h1>{account.accountNumber}</h1>
          <p>{account.product?.name ?? account.accountType.replaceAll("_", " ")}</p>
        </div>
        <div className="header-actions">
          <span className={`status status-prominent ${savingsStatusTone(account.status)}`}>{account.status.replaceAll("_", " ")}</span>
          <Link className="secondary-action" href="/portal">
            Back
          </Link>
        </div>
      </header>

      <section className="loan-summary-metrics">
        <article>
          <span>Balance</span>
          <strong>{formatMinor(balanceMinor, account.currencyCode)}</strong>
        </article>
        <article>
          <span>Product</span>
          <strong>{account.product?.name ?? account.accountType.replaceAll("_", " ")}</strong>
        </article>
        <article>
          <span>Currency</span>
          <strong>{account.currencyCode}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent transactions</h2>
            <p>Most recent 25 · immutable account activity</p>
          </div>
        </div>
        {account.transactions.length === 0 ? (
          <div className="empty-state compact-empty">
            <PiggyBank size={26} />
            <strong>No transactions</strong>
          </div>
        ) : (
          <div className="table-scroll table-scroll-capped">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {account.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{portalDateTimeFormatter.format(transaction.createdAt)}</td>
                    <td>{transaction.transactionType.replaceAll("_", " ")}</td>
                    <td>{transaction.reason ?? transaction.externalReference ?? "\u2014"}</td>
                    <td>{formatMinor(transaction.amountMinor, account.currencyCode)}</td>
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

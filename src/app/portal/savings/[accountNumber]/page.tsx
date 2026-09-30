import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalIcon } from "@/components/portal/portal-icon";
import { prisma } from "@/lib/prisma";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { displaySavingsProductName } from "@/modules/savings/domain/savings-product-label";

import { getPortalClient } from "../../_lib/portal-context";

const whenFormat = new Intl.DateTimeFormat("en-UG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Africa/Kampala",
});

function plainWords(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function PortalSavingsAccountPage({ params }: { params: Promise<{ accountNumber: string }> }) {
  const { client } = await getPortalClient();
  const { accountNumber } = await params;

  const account = await prisma.savingsAccount.findFirst({
    where: { accountNumber, clientId: client.id },
    include: {
      product: true,
      transactions: { orderBy: { createdAt: "desc" }, take: 40 },
    },
  });
  if (!account) notFound();

  const totals = await prisma.savingsTransaction.aggregate({
    where: { savingsAccountId: account.id },
    _sum: { amountMinor: true },
    _count: true,
  });
  const balanceMinor = totals._sum.amountMinor ?? 0n;
  const productName = displaySavingsProductName(account.product?.name ?? account.accountType.replaceAll("_", " "));

  return (
    <div className="portal-detail">
      <Link className="portal-back" href="/portal">
        Back
      </Link>
      <header className="portal-hello">
        <p>{productName}</p>
        <h1>{account.accountNumber}</h1>
        <small>{plainWords(account.status)}</small>
      </header>
      <section className="portal-card" aria-label="Savings balance">
        <span>Balance</span>
        <strong>{formatMinor(balanceMinor, account.currencyCode)}</strong>
      </section>
      <section className="portal-feed" aria-labelledby="savings-activity">
        <div className="portal-feed-head">
          <h2 id="savings-activity">Transactions</h2>
          <p>{totals._count}</p>
        </div>
        {account.transactions.length === 0 ? (
          <p className="portal-empty">
            <strong>No transactions</strong>
            Deposits and withdrawals on this account will show up here.
          </p>
        ) : (
          <ul className="portal-feed-list">
            {account.transactions.map((transaction) => {
              const tone = transaction.amountMinor < 0n ? "out" : transaction.amountMinor > 0n ? "in" : "note";
              const amount = transaction.amountMinor < 0n ? -transaction.amountMinor : transaction.amountMinor;
              const title = plainWords(transaction.transactionType);
              return (
                <li key={transaction.id}>
                  <div>
                    <PortalIcon seed={title} />
                    <span>
                      <strong>{title}</strong>
                      <small>
                        {whenFormat.format(transaction.createdAt)}
                        {transaction.reason ? ` · ${transaction.reason}` : ""}
                      </small>
                    </span>
                    <b className={`portal-amount ${tone}`}>
                      {tone === "in" ? "+" : tone === "out" ? "−" : ""}
                      {formatMinor(amount, account.currencyCode)}
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

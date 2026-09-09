import type { LoanStatus } from "@prisma/client";
import { CircleDollarSign } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { DataTable } from "@/components/ui/data-table";
import { auth } from "@/lib/auth";
import { getLoanTodayTransactionsConfig, type LoanTodayTransactionKind } from "@/lib/loan-today-transactions-config";
import { transactionTypeVariants } from "@/lib/loan-transaction-type-variants";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, loanScopeWhere } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

export type { LoanTodayTransactionKind };

type TodayTransaction = {
  id: string;
  denominationAmountMinor: bigint;
  settlementChannel: string;
  externalReference: string | null;
  reversedById: string | null;
  loan: {
    id: string;
    accountNumber: string;
    status: LoanStatus;
    denominationCurrency: string;
    office: { name: string };
    product: { name: string };
    client: { firstName: string; middleName: string | null; lastName: string } | null;
    group: { name: string } | null;
  };
};

export async function LoanTodayTransactionsPage({ kind }: { kind: LoanTodayTransactionKind }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const userScope = await getUserDataScope(prisma, session.user.id);
  if (!userScope) redirect("/");

  const config = getLoanTodayTransactionsConfig(kind);

  const now = new Date();
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const transactions: TodayTransaction[] = await prisma.loanTransaction.findMany({
    where: {
      businessDate: { gte: today, lt: tomorrow },
      transactionType: { in: transactionTypeVariants(kind) },
      loan: {
        office: { organizationId: userScope.organizationId },
        ...loanScopeWhere(userScope),
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

  const totalMinor = transactions.reduce((sum, transaction) => sum + transaction.denominationAmountMinor, 0n);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Loans", href: "/loans" }, { label: config.breadcrumbLabel }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h1>{config.heading}</h1>
          <p>
            {transactions.length.toLocaleString()} {config.summaryNoun} · {formatMinor(totalMinor, "UGX")} {config.summaryVerb} today
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
            <h2>{config.sectionHeading}</h2>
            <p>{config.sectionDescription}</p>
          </div>
          <CircleDollarSign size={19} />
        </div>
        <DataTable
          columns={[
            {
              key: "borrower",
              header: "Borrower",
              render: (transaction) => (
                <>
                  <strong>{borrowerLabel(transaction.loan.client, transaction.loan.group)}</strong>
                  <small className="mono">{transaction.loan.accountNumber}</small>
                </>
              ),
            },
            { key: "product", header: "Product", render: (transaction) => transaction.loan.product.name },
            { key: "office", header: "Office", render: (transaction) => transaction.loan.office.name },
            { key: "channel", header: "Channel", render: (transaction) => transaction.settlementChannel },
            { key: "reference", header: "Reference", render: (transaction) => transaction.externalReference ?? "—" },
            {
              key: "amount",
              header: "Amount",
              render: (transaction) => formatMinor(transaction.denominationAmountMinor, transaction.loan.denominationCurrency),
            },
            {
              key: "loanStatus",
              header: "Loan status",
              render: (transaction) => (
                <span className={`status ${loanStatusTone(transaction.loan.status)}`}>
                  {transaction.loan.status.replaceAll("_", " ")}
                </span>
              ),
            },
            {
              key: "transaction",
              header: "Transaction",
              render: (transaction) => (
                <span className={`status ${transaction.reversedById ? "review" : "up-to-date"}`}>
                  {transaction.reversedById ? "Reversed" : "Recorded"}
                </span>
              ),
            },
          ]}
          emptyState={
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>{config.emptyTitle}</strong>
              <p>{config.emptyDescription}</p>
            </div>
          }
          getRowAriaLabel={(transaction) => `Open ${transaction.loan.accountNumber}`}
          getRowKey={(transaction) => transaction.id}
          rowHref={(transaction) => `/loans/${transaction.loan.id}`}
          rows={transactions}
        />
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

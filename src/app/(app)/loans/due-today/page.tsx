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

export default async function LoansDueTodayPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const userScope = await getUserDataScope(prisma, session.user.id);
  if (!userScope) redirect("/");

  const now = new Date();
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const installments = await prisma.loanInstallment.findMany({
    where: {
      dueOn: { gte: today, lt: tomorrow },
      loan: {
        office: { organizationId: userScope.organizationId },
        ...officeWhere(userScope),
      },
    },
    select: {
      principalDueMinor: true,
      interestDueMinor: true,
      feesDueMinor: true,
      penaltiesDueMinor: true,
      principalPaidMinor: true,
      interestPaidMinor: true,
      feesPaidMinor: true,
      penaltiesPaidMinor: true,
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
  });

  const rows = Array.from(
    installments.reduce(
      (grouped, installment) => {
        const scheduledMinor = scheduledAmount(installment);
        const outstandingMinor = outstandingAmount(installment);
        const existing = grouped.get(installment.loan.id);

        if (existing) {
          existing.installmentCount += 1;
          existing.scheduledMinor += scheduledMinor;
          existing.outstandingMinor += outstandingMinor;
          return grouped;
        }

        grouped.set(installment.loan.id, {
          id: installment.loan.id,
          borrower: borrowerLabel(installment.loan.client, installment.loan.group),
          accountNumber: installment.loan.accountNumber,
          product: installment.loan.product.name,
          office: installment.loan.office.name,
          status: installment.loan.status,
          currencyCode: installment.loan.denominationCurrency,
          installmentCount: 1,
          scheduledMinor,
          outstandingMinor,
        });
        return grouped;
      },
      new Map<
        string,
        {
          id: string;
          borrower: string;
          accountNumber: string;
          product: string;
          office: string;
          status: LoanStatus;
          currencyCode: string;
          installmentCount: number;
          scheduledMinor: bigint;
          outstandingMinor: bigint;
        }
      >(),
    ).values(),
  ).sort((left, right) => {
    if (left.outstandingMinor === right.outstandingMinor) {
      return left.borrower.localeCompare(right.borrower);
    }
    return left.outstandingMinor > right.outstandingMinor ? -1 : 1;
  });

  const totalScheduledMinor = rows.reduce((sum, row) => sum + row.scheduledMinor, 0n);
  const totalOutstandingMinor = rows.reduce((sum, row) => sum + row.outstandingMinor, 0n);
  const scheduledPayments = rows.reduce((sum, row) => sum + row.installmentCount, 0);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Loans", href: "/loans" }, { label: "Due today" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Daily collections</p>
          <h1>Loans due today</h1>
          <p>
            {rows.length.toLocaleString()} loans · {scheduledPayments.toLocaleString()} scheduled payments · {formatMinor(totalOutstandingMinor, "UGX")} outstanding
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
            <h2>Repayments scheduled today</h2>
            <p>{formatMinor(totalScheduledMinor, "UGX")} scheduled across your current office scope</p>
          </div>
          <CircleDollarSign size={19} />
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <CircleDollarSign size={28} />
            <strong>No loans due today</strong>
            <p>There are no installments scheduled in your current office scope today.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th>Product</th>
                  <th>Office</th>
                  <th>Status</th>
                  <th>Due items</th>
                  <th>Scheduled today</th>
                  <th>Outstanding today</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.borrower}</strong>
                      <small className="mono">{row.accountNumber}</small>
                      <Link className="row-link" href={`/loans/${row.id}`} aria-label={`Open ${row.accountNumber}`} />
                    </td>
                    <td>{row.product}</td>
                    <td>{row.office}</td>
                    <td>
                      <span className={`status ${loanStatusTone(row.status)}`}>{row.status.replaceAll("_", " ")}</span>
                    </td>
                    <td>{row.installmentCount}</td>
                    <td>{formatMinor(row.scheduledMinor, row.currencyCode)}</td>
                    <td>{formatMinor(row.outstandingMinor, row.currencyCode)}</td>
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

function scheduledAmount(installment: {
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  feesDueMinor: bigint;
  penaltiesDueMinor: bigint;
}) {
  return (
    installment.principalDueMinor +
    installment.interestDueMinor +
    installment.feesDueMinor +
    installment.penaltiesDueMinor
  );
}

function outstandingAmount(installment: {
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  feesDueMinor: bigint;
  penaltiesDueMinor: bigint;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  feesPaidMinor: bigint;
  penaltiesPaidMinor: bigint;
}) {
  const amount =
    scheduledAmount(installment) -
    installment.principalPaidMinor -
    installment.interestPaidMinor -
    installment.feesPaidMinor -
    installment.penaltiesPaidMinor;
  return amount > 0n ? amount : 0n;
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

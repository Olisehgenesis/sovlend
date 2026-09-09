import { Landmark, PiggyBank } from "lucide-react";
import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { loanOutstandingMinor } from "@/modules/lending/domain/loan-outstanding";

import { getPortalClient } from "./_lib/portal-context";

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

export default async function PortalDashboardPage() {
  const { client } = await getPortalClient();

  const [loans, savingsAccounts] = await Promise.all([
    prisma.loan.findMany({
      where: { clientId: client.id },
      include: {
        product: { select: { name: true } },
        installments: {
          select: {
            principalDueMinor: true,
            interestDueMinor: true,
            feesDueMinor: true,
            penaltiesDueMinor: true,
            monitoringFeeDueMinor: true,
            principalPaidMinor: true,
            interestPaidMinor: true,
            feesPaidMinor: true,
            penaltiesPaidMinor: true,
            monitoringFeePaidMinor: true,
            principalWaivedMinor: true,
            interestWaivedMinor: true,
            feesWaivedMinor: true,
            penaltiesWaivedMinor: true,
            monitoringFeeWaivedMinor: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.savingsAccount.findMany({
      where: { clientId: client.id },
      include: {
        product: { select: { name: true } },
        transactions: { select: { amountMinor: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="directory-page portal-page">
      <header className="directory-header">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Welcome, {client.firstName}</h1>
          <p>
            {client.accountNumber} · {client.office.name}
          </p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              <Landmark size={17} /> Your loans
            </h2>
            <p>{loans.length} loan account(s) on record</p>
          </div>
        </div>
        {loans.length === 0 ? (
          <div className="empty-state compact-empty">
            <strong>No loans yet</strong>
            <p>Loans you take out will appear here.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Principal</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => {
                  const outstanding = loanOutstandingMinor(loan.installments, loan);
                  return (
                    <tr key={loan.id}>
                      <td>
                        <strong className="mono">{loan.accountNumber}</strong>
                        <Link className="row-link" href={`/portal/loans/${loan.id}`} aria-label={`Open loan ${loan.accountNumber}`} />
                      </td>
                      <td>{loan.product.name}</td>
                      <td>
                        <span className={`status ${loanStatusTone(loan.status)}`}>{loan.status.replaceAll("_", " ")}</span>
                      </td>
                      <td className="mono">{formatMinor(loan.principalMinor, loan.denominationCurrency)}</td>
                      <td className="mono">{formatMinor(outstanding, loan.denominationCurrency)}</td>
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
            <h2>
              <PiggyBank size={17} /> Your savings accounts
            </h2>
            <p>{savingsAccounts.length} account(s) on record</p>
          </div>
        </div>
        {savingsAccounts.length === 0 ? (
          <div className="empty-state compact-empty">
            <strong>No savings accounts yet</strong>
            <p>Savings, share and deposit accounts will appear here once opened.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {savingsAccounts.map((account) => {
                  const balanceMinor = account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
                  return (
                    <tr key={account.id}>
                      <td>
                        <strong className="mono">{account.accountNumber}</strong>
                        <Link className="row-link" href={`/portal/savings/${account.accountNumber}`} aria-label={`Open savings account ${account.accountNumber}`} />
                      </td>
                      <td>{account.product?.name ?? "—"}</td>
                      <td>
                        <span className={`status ${account.status === "ACTIVE" ? "up-to-date" : "review"}`}>{account.status.replaceAll("_", " ")}</span>
                      </td>
                      <td className="mono">{formatMinor(balanceMinor, account.currencyCode)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

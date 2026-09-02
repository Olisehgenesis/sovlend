import { CircleDollarSign } from "lucide-react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { RepaymentForm } from "@/components/repayment-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

export default async function LoanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const loan = await prisma.loan.findFirst({
    where: {
      id: (await params).id,
      client: { organizationId: scope.organizationId },
    },
    include: {
      client: { include: { office: true } },
      product: true,
      installments: { orderBy: { installmentNumber: "asc" } },
      transactions: {
        include: { allocations: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId)))
    notFound();
  const totals = loan.installments.reduce(
    (sum, item) => ({
      due:
        sum.due +
        item.principalDueMinor +
        item.interestDueMinor +
        item.feesDueMinor +
        item.penaltiesDueMinor,
      paid:
        sum.paid +
        item.principalPaidMinor +
        item.interestPaidMinor +
        item.feesPaidMinor +
        item.penaltiesPaidMinor,
    }),
    { due: 0n, paid: 0n },
  );
  const settlementAccounts = await prisma.settlementAccount.findMany({
    where: { organizationId: scope.organizationId, currencyCode: loan.denominationCurrency, active: true },
    select: { id: true, name: true, type: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[{ label: "Loans", href: "/loans" }, { label: loan.accountNumber }]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Loan account</p>
          <h1>{loan.accountNumber}</h1>
          <p>
            {loan.client.firstName} {loan.client.lastName} · {loan.product.name}
          </p>
        </div>
        <span
          className={`status status-prominent ${loan.status === "ACTIVE" ? "up-to-date" : loan.status === "IN_ARREARS" ? "in-arrears" : "review"}`}
        >
          {loan.status.replaceAll("_", " ")}
        </span>
      </header>
      <section className="loan-summary-metrics">
        <article>
          <span>Status</span>
          <strong>{loan.status}</strong>
        </article>
        <article>
          <span>Principal</span>
          <strong>
            {formatMinor(loan.principalMinor, loan.denominationCurrency)}
          </strong>
        </article>
        <article>
          <span>Total scheduled</span>
          <strong>{formatMinor(totals.due, loan.denominationCurrency)}</strong>
        </article>
        <article>
          <span>Outstanding</span>
          <strong>
            {formatMinor(totals.due - totals.paid, loan.denominationCurrency)}
          </strong>
        </article>
      </section>
      {["ACTIVE", "IN_ARREARS", "OVERPAID"].includes(loan.status) ? (
        <section className="panel repayment-panel">
          <RepaymentForm
            loanId={loan.id}
            settlementAccounts={settlementAccounts}
          />
        </section>
      ) : null}
      <section className="loan-route-grid servicing-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Repayment schedule</h2>
              <p>
                {loan.installments.length} installments · matures{" "}
                {loan.maturesOn?.toLocaleDateString() ?? "not set"}
              </p>
            </div>
          </div>
          {loan.installments.length === 0 ? (
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>No schedule yet</strong>
              <p>The schedule is created at disbursement.</p>
            </div>
          ) : (
            <div className="table-scroll">
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
                    const due =
                      item.principalDueMinor +
                      item.interestDueMinor +
                      item.feesDueMinor +
                      item.penaltiesDueMinor;
                    const paid =
                      item.principalPaidMinor +
                      item.interestPaidMinor +
                      item.feesPaidMinor +
                      item.penaltiesPaidMinor;
                    return (
                      <tr key={item.id}>
                        <td>{item.installmentNumber}</td>
                        <td>{item.dueOn.toLocaleDateString()}</td>
                        <td>
                          {formatMinor(
                            item.principalDueMinor,
                            loan.denominationCurrency,
                          )}
                        </td>
                        <td>
                          {formatMinor(
                            item.interestDueMinor,
                            loan.denominationCurrency,
                          )}
                        </td>
                        <td>
                          {formatMinor(
                            item.feesDueMinor,
                            loan.denominationCurrency,
                          )}
                        </td>
                        <td>
                          {formatMinor(
                            item.penaltiesDueMinor,
                            loan.denominationCurrency,
                          )}
                        </td>
                        <td>{formatMinor(paid, loan.denominationCurrency)}</td>
                        <td>
                          {formatMinor(due - paid, loan.denominationCurrency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Transactions</h2>
              <p>Immutable account activity</p>
            </div>
          </div>
          {loan.transactions.length === 0 ? (
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>No transactions</strong>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Channel</th>
                    <th>Amount</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {loan.transactions.map((item) => (
                    <tr key={item.id}>
                      <td>{item.businessDate.toLocaleDateString()}</td>
                      <td>{item.transactionType}</td>
                      <td>{item.settlementChannel}</td>
                      <td>
                        {formatMinor(
                          item.denominationAmountMinor,
                          loan.denominationCurrency,
                        )}
                      </td>
                      <td>{item.externalReference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

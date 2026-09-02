import { CircleDollarSign } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LoanCollateralPanel } from "@/components/loan-collateral-panel";
import { LoanChargesPanel } from "@/components/loan-charge-panel";
import { LoanDocumentsPanel, LoanNotesPanel } from "@/components/loan-record-forms";
import { RepaymentForm } from "@/components/repayment-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";

export default async function LoanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const tab = (await searchParams).tab;
  const activeTab = tab === "charges" || tab === "overdue-charges" || tab === "documents" || tab === "notes" || tab === "collateral" ? tab : "schedule";
  const loan = await prisma.loan.findFirst({
    where: {
      id: (await params).id,
      client: { organizationId: scope.organizationId },
    },
    include: {
      client: { include: { office: true } },
      product: true,
      charges: { orderBy: { createdAt: "desc" } },
      collateralItems: { orderBy: { createdAt: "desc" } },
      documents: { orderBy: { createdAt: "desc" } },
      notes: {
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      installments: { orderBy: { installmentNumber: "asc" } },
      transactions: {
        include: { allocations: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!loan || (scope.officeIds && !scope.officeIds.includes(loan.officeId)))
    notFound();

  const authorization = new AuthorizationService(prisma);
  const canManageCharges = await authorization.isAllowed({
    actorUserId: session.user.id,
    permission: permissions.clientManage,
    organizationId: scope.organizationId,
    officeId: loan.officeId,
  });

  const today = new Date();
  const overdueCharges = loan.charges.filter(
    (charge) => charge.status === "PENDING" && charge.dueOn && charge.dueOn < today,
  );
  const overdueChargesMinor = overdueCharges.reduce(
    (sum, charge) => sum + charge.amountMinor,
    0n,
  );

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
      <nav className="client-tabs" aria-label="Loan record sections">
        <Link className={activeTab === "schedule" ? "active" : ""} href={`/loans/${loan.id}`}>Repayment Schedule</Link>
        <Link className={activeTab === "charges" ? "active" : ""} href={`/loans/${loan.id}?tab=charges`}>Charges</Link>
        <Link className={activeTab === "overdue-charges" ? "active" : ""} href={`/loans/${loan.id}?tab=overdue-charges`}>Overdue Charges</Link>
        <Link className={activeTab === "collateral" ? "active" : ""} href={`/loans/${loan.id}?tab=collateral`}>Loan Collateral</Link>
        <Link className={activeTab === "documents" ? "active" : ""} href={`/loans/${loan.id}?tab=documents`}>Loan Documents</Link>
        <Link className={activeTab === "notes" ? "active" : ""} href={`/loans/${loan.id}?tab=notes`}>Notes</Link>
      </nav>
      {["ACTIVE", "IN_ARREARS", "OVERPAID"].includes(loan.status) ? (
        <section className="panel repayment-panel">
          <RepaymentForm
            loanId={loan.id}
            settlementAccounts={settlementAccounts}
          />
        </section>
      ) : null}
      {activeTab === "charges" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Charges</h2>
              <p>Fees and penalties applied to this loan</p>
            </div>
          </div>
          <LoanChargesPanel
            loanId={loan.id}
            canManage={canManageCharges}
            charges={loan.charges.map((charge) => ({
              id: charge.id,
              name: charge.name,
              amountMinor: charge.amountMinor.toString(),
              currencyCode: charge.currencyCode,
              status: charge.status,
              dueOnFormatted: charge.dueOn
                ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(charge.dueOn)
                : null,
            }))}
          />
        </section>
      ) : null}
      {activeTab === "overdue-charges" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Overdue charges</h2>
              <p>
                {overdueCharges.length} overdue item(s) · {formatMinor(overdueChargesMinor, loan.denominationCurrency)} outstanding
              </p>
            </div>
          </div>
          {overdueCharges.length === 0 ? (
            <div className="empty-state compact-empty">
              <strong>No overdue charges</strong>
              <p>This loan has no pending charges past due date.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Charge</th>
                    <th>Due date</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueCharges.map((charge) => (
                    <tr key={charge.id}>
                      <td>{charge.name}</td>
                      <td>{charge.dueOn?.toLocaleDateString() ?? "-"}</td>
                      <td className="mono">{formatMinor(charge.amountMinor, charge.currencyCode)}</td>
                      <td>
                        <span className="status in-arrears">{charge.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
      {activeTab === "collateral" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Loan collateral</h2>
              <p>Security items pledged against this loan</p>
            </div>
          </div>
          <LoanCollateralPanel
            loanId={loan.id}
            canManage={canManageCharges}
            items={loan.collateralItems.map((item) => ({
              id: item.id,
              type: item.type,
              description: item.description,
              estimatedValueMinor: item.estimatedValueMinor?.toString() ?? null,
              valuationCurrencyCode: item.valuationCurrencyCode,
              valuationDateLabel: item.valuationDate
                ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(item.valuationDate)
                : null,
              status: item.status,
            }))}
          />
        </section>
      ) : null}
      {activeTab === "documents" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Loan documents</h2>
              <p>Supporting files attached to this loan</p>
            </div>
          </div>
          <LoanDocumentsPanel
            loanId={loan.id}
            canManage={canManageCharges}
            documents={loan.documents.map((document) => ({
              id: document.id,
              name: document.name,
              description: document.description,
              mediaType: document.mediaType,
              createdAtLabel: new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(document.createdAt),
            }))}
          />
        </section>
      ) : null}
      {activeTab === "notes" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Notes</h2>
              <p>Internal notes visible to your office</p>
            </div>
          </div>
          <LoanNotesPanel
            loanId={loan.id}
            canManage={canManageCharges}
            notes={loan.notes.map((note) => ({
              id: note.id,
              body: note.body,
              authorName: note.author.name,
              createdAtLabel: new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(note.createdAt),
            }))}
          />
        </section>
      ) : null}
      {activeTab === "schedule" ? (
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
                        {formatMinor(item.denominationAmountMinor, loan.denominationCurrency)}
                      </td>
                      <td>{item.externalReference ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
      ) : null}
    </main>
  );
}

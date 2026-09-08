import { CircleDollarSign } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

import { LoanCollateralPanel } from "@/components/loan-collateral-panel";
import { LoanChargesPanel } from "@/components/loan-charge-panel";
import { LoanDocumentsPanel, LoanNotesPanel } from "@/components/loan-record-forms";
import { LoanOfficerAssignment } from "@/components/loan-officer-assignment";
import { LoanServiceActionsPanel } from "@/components/loan-service-actions-panel";
import { DisburseLoanButton } from "@/components/disburse-loan-button";
import { RecordPaymentButton } from "@/components/record-payment-button";
import { RepaymentForm } from "@/components/repayment-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";
import {
  installmentOutstandingMinor,
  installmentWaivedMinor,
  loanOutstandingMinor,
  loanWrittenOffMinor,
} from "@/modules/lending/domain/loan-outstanding";

// A loan's originating terms are locked in at approval time in `termsSnapshot` (see
// approve-loan-application.ts) precisely so that later edits to the live LoanProduct row
// (rate, method, repayment count, etc.) never change what an already-issued loan shows or
// owes. Prefer the snapshot for display; only fall back to the live product for legacy
// loans created before this field existed.
function snapshotRecord(snapshot: Prisma.JsonValue | null) {
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : null;
}
function snapshotString(snapshot: Prisma.JsonValue | null, key: string) {
  const value = snapshotRecord(snapshot)?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
function snapshotNumber(snapshot: Prisma.JsonValue | null, key: string) {
  const value = snapshotRecord(snapshot)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
  const activeTab =
    tab === "schedule" ||
    tab === "record-payment" ||
    tab === "charges" ||
    tab === "overdue-charges" ||
    tab === "documents" ||
    tab === "notes" ||
    tab === "collateral" ||
    tab === "guarantors" ||
    tab === "servicing"
      ? tab
      : "details";
  const loan = await prisma.loan.findFirst({
    where: {
      id: (await params).id,
      office: { organizationId: scope.organizationId },
    },
    include: {
      client: { include: { office: true } },
      group: { select: { name: true, accountNumber: true } },
      office: { select: { name: true } },
      loanOfficer: { select: { name: true } },
      fund: { select: { name: true } },
      product: true,
      charges: { orderBy: { createdAt: "desc" } },
      collateralItems: { orderBy: { createdAt: "desc" } },
      guarantors: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      documents: { orderBy: { createdAt: "desc" } },
      notes: {
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      installments: { orderBy: { installmentNumber: "asc" } },
      transactions: {
        include: { allocations: true, recordedBy: { select: { name: true } } },
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
  const canRequestServiceActions = await authorization.isAllowed({
    actorUserId: session.user.id,
    permission: permissions.loanReverse,
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
      waived: sum.waived + installmentWaivedMinor(item),
    }),
    { due: 0n, paid: 0n, waived: 0n },
  );
  const writtenOff = loanWrittenOffMinor(loan);
  const outstanding = loanOutstandingMinor(loan.installments, loan);
  const settlementAccounts = await prisma.settlementAccount.findMany({
    where: { organizationId: scope.organizationId, currencyCode: loan.denominationCurrency, active: true },
    select: { id: true, name: true, type: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const officeOfficers = await prisma.user.findMany({
    where: { organizationId: scope.organizationId, officeId: loan.officeId, systemRole: "LOAN_OFFICER" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const serviceRequests = await prisma.loanServiceRequest.findMany({
    where: { loanId: loan.id },
    include: { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
    orderBy: { requestedAt: "desc" },
  });
  const savingsAccounts = loan.clientId
    ? await prisma.savingsAccount.findMany({
        where: {
          clientId: loan.clientId,
          status: "ACTIVE",
          currencyCode: loan.denominationCurrency,
        },
        select: {
          id: true,
          accountNumber: true,
          isDefault: true,
          product: { select: { name: true } },
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
    : [];
  const hasPendingDisbursement =
    loan.status === "ACTIVE" &&
    Boolean(loan.disbursedOn) &&
    loan.transactions.every((item) => item.transactionType === "DISBURSEMENT");
  const canDisburseFromHeader = loan.status === "APPROVED" && !loan.disbursedOn;
  const isOpenLoan = ["ACTIVE", "IN_ARREARS", "OVERPAID"].includes(loan.status);
  const nextDueInstallment = [...loan.installments]
    .sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime() || left.installmentNumber - right.installmentNumber)
    .find((installment) => installmentOutstandingMinor(installment) > 0n);
  const nextDueAmountMinor = nextDueInstallment ? installmentOutstandingMinor(nextDueInstallment) : 0n;
  const repaymentTransactions = loan.transactions
    .filter((item) => item.transactionType === "REPAYMENT" && !item.reversedById)
    .map((item) => ({
      id: item.id,
      label: `${item.businessDate.toLocaleDateString()} · ${formatMinor(item.denominationAmountMinor, loan.denominationCurrency)}${item.externalReference ? ` · ${item.externalReference}` : ""}`,
    }));
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
            {loan.client ? `${loan.client.firstName} ${loan.client.lastName}` : `Group: ${loan.group?.name ?? "Unknown"}`} · {loan.product.name}
          </p>
        </div>
        <div className="header-actions">
          {canDisburseFromHeader ? (
            <DisburseLoanButton
              loanId={loan.id}
              savingsAccounts={savingsAccounts.map((account) => ({
                id: account.id,
                accountNumber: account.accountNumber,
                isDefault: account.isDefault,
                productName: account.product?.name ?? null,
              }))}
              settlementAccounts={settlementAccounts}
            />
          ) : null}
          {isOpenLoan ? (
            <RecordPaymentButton
              defaultAmountMinor={nextDueAmountMinor.toString()}
              loanId={loan.id}
              settlementAccounts={settlementAccounts}
            />
          ) : null}
          <span
            className={`status status-prominent ${loan.status === "ACTIVE" ? "up-to-date" : loan.status === "IN_ARREARS" ? "in-arrears" : "review"}`}
          >
            {loan.status.replaceAll("_", " ")}
          </span>
        </div>
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
            {formatMinor(outstanding, loan.denominationCurrency)}
          </strong>
        </article>
      </section>
      <nav className="client-tabs" aria-label="Loan record sections">
        <Link className={activeTab === "details" ? "active" : ""} href={`/loans/${loan.id}`}>Details</Link>
        <Link className={activeTab === "schedule" ? "active" : ""} href={`/loans/${loan.id}?tab=schedule`}>Repayment Schedule</Link>
        {isOpenLoan ? (
          <Link className={activeTab === "record-payment" ? "active" : ""} href={`/loans/${loan.id}?tab=record-payment`}>Record Payment</Link>
        ) : null}
        <Link className={activeTab === "charges" ? "active" : ""} href={`/loans/${loan.id}?tab=charges`}>Charges</Link>
        <Link className={activeTab === "overdue-charges" ? "active" : ""} href={`/loans/${loan.id}?tab=overdue-charges`}>Overdue Charges</Link>
        <Link className={activeTab === "collateral" ? "active" : ""} href={`/loans/${loan.id}?tab=collateral`}>Loan Collateral</Link>
        <Link className={activeTab === "guarantors" ? "active" : ""} href={`/loans/${loan.id}?tab=guarantors`}>Guarantors</Link>
        <Link className={activeTab === "documents" ? "active" : ""} href={`/loans/${loan.id}?tab=documents`}>Loan Documents</Link>
        <Link className={activeTab === "notes" ? "active" : ""} href={`/loans/${loan.id}?tab=notes`}>Notes</Link>
        <Link className={activeTab === "servicing" ? "active" : ""} href={`/loans/${loan.id}?tab=servicing`}>Servicing</Link>
      </nav>
      {activeTab === "record-payment" && isOpenLoan ? (
        <section className="panel repayment-panel">
          <RepaymentForm
            loanId={loan.id}
            settlementAccounts={settlementAccounts}
            defaultAmountMinor={nextDueAmountMinor.toString()}
          />
        </section>
      ) : null}
      {activeTab === "details" ? (
        <section className="panel review-summary">
          <div className="panel-heading">
            <div>
              <h2>Loan details</h2>
              <p>Terms captured at origination and current lifecycle dates</p>
            </div>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Loan account</dt>
              <dd>{loan.accountNumber}</dd>
            </div>
            <div>
              <dt>Borrower</dt>
              <dd>
                {loan.client
                  ? `${loan.client.firstName} ${loan.client.lastName} · ${loan.client.accountNumber}`
                  : `Group: ${loan.group?.name ?? "Unknown"} · ${loan.group?.accountNumber ?? "—"}`}
              </dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd>{loan.product.name}</dd>
            </div>
            <div>
              <dt>Fund</dt>
              <dd>{loan.fund?.name ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Office</dt>
              <dd>{loan.office?.name ?? loan.client?.office?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Loan officer</dt>
              <dd>
                {canManageCharges ? (
                  <LoanOfficerAssignment currentOfficerId={loan.loanOfficerId} loanId={loan.id} officers={officeOfficers} />
                ) : (
                  loan.loanOfficer?.name ?? "Unassigned"
                )}
              </dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{loan.denominationCurrency}</dd>
            </div>
            <div>
              <dt>Principal (taken)</dt>
              <dd>{formatMinor(loan.principalMinor, loan.denominationCurrency)}</dd>
            </div>
            <div>
              <dt>Interest rate</dt>
              <dd>
                {(
                  (snapshotNumber(loan.termsSnapshot, "annualRateBps") ??
                    loan.product.annualRateBps) / 100
                ).toFixed(2)}
                % per annum
              </dd>
            </div>
            <div>
              <dt>Interest method</dt>
              <dd>
                {(
                  snapshotString(loan.termsSnapshot, "interestMethod") ??
                  loan.product.interestMethod
                ).replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt>Monitoring fee</dt>
              <dd>
                {(
                  (snapshotNumber(loan.termsSnapshot, "monitoringFeeAnnualRateBps") ??
                    loan.product.monitoringFeeAnnualRateBps) / 100
                ).toFixed(2)}
                % per annum
              </dd>
            </div>
            <div>
              <dt>Amortization</dt>
              <dd>
                {(
                  snapshotString(loan.termsSnapshot, "amortizationMethod") ??
                  loan.product.amortizationMethod
                ).replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt>Repayment frequency</dt>
              <dd>
                {(
                  snapshotString(loan.termsSnapshot, "repaymentFrequency") ??
                  loan.product.repaymentFrequency
                ).replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt>Number of repayments</dt>
              <dd>
                {snapshotNumber(loan.termsSnapshot, "repaymentCount") ??
                  loan.product.repaymentCount}
              </dd>
            </div>
            <div>
              <dt>Disbursed on</dt>
              <dd>{loan.disbursedOn ? loan.disbursedOn.toLocaleDateString() : "Not yet disbursed"}</dd>
            </div>
            <div>
              <dt>Matures on</dt>
              <dd>{loan.maturesOn ? loan.maturesOn.toLocaleDateString() : "Not set"}</dd>
            </div>
            <div>
              <dt>Total scheduled</dt>
              <dd>{formatMinor(totals.due, loan.denominationCurrency)}</dd>
            </div>
            <div>
              <dt>Total paid</dt>
              <dd>{formatMinor(totals.paid, loan.denominationCurrency)}</dd>
            </div>
            <div>
              <dt>Waived</dt>
              <dd>{formatMinor(totals.waived, loan.denominationCurrency)}</dd>
            </div>
            <div>
              <dt>Written off</dt>
              <dd>{formatMinor(writtenOff, loan.denominationCurrency)}</dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{formatMinor(outstanding, loan.denominationCurrency)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`status ${loan.status === "ACTIVE" ? "up-to-date" : loan.status === "IN_ARREARS" ? "in-arrears" : "review"}`}>
                  {loan.status.replaceAll("_", " ")}
                </span>
              </dd>
            </div>
            <div>
              <dt>Application submitted</dt>
              <dd>{loan.createdAt.toLocaleDateString()}</dd>
            </div>
          </dl>
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
              <table className="clickable-rows">
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
                      <td>
                        <strong>{charge.name}</strong>
                        <Link className="row-link" href={`/loans/${loan.id}/charges/${charge.id}`} aria-label={`Open overdue charge ${charge.name}`} />
                      </td>
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
      {activeTab === "guarantors" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Guarantors</h2>
              <p>People recorded as vouching for this loan</p>
            </div>
          </div>
          {loan.guarantors.length === 0 ? (
            <div className="empty-state compact-empty">
              <strong>No guarantors on record</strong>
              <p>This loan has no guarantors recorded.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="clickable-rows">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Relationship</th>
                    <th>Phone</th>
                    <th>Date of birth</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loan.guarantors.map((guarantor) => (
                    <tr key={guarantor.id}>
                      <td>
                        <strong>{[guarantor.firstName, guarantor.lastName].filter(Boolean).join(" ") || "Unnamed guarantor"}</strong>
                        <Link className="row-link" href={`/loans/${loan.id}/guarantors/${guarantor.id}`} aria-label={`Open guarantor ${[guarantor.firstName, guarantor.lastName].filter(Boolean).join(" ") || "record"}`} />
                      </td>
                      <td>{guarantor.guarantorType}</td>
                      <td>{guarantor.relationship ?? "-"}</td>
                      <td>{guarantor.phone ?? "-"}</td>
                      <td>
                        {guarantor.dateOfBirth
                          ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(guarantor.dateOfBirth)
                          : "-"}
                      </td>
                      <td>
                        <span className={`status ${guarantor.active ? "up-to-date" : "review"}`}>
                          {guarantor.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
      {activeTab === "servicing" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>High-risk servicing actions</h2>
              <p>Undo disbursal, prepay, foreclosure, and transaction reversal — all maker-checker controlled</p>
            </div>
          </div>
          <LoanServiceActionsPanel
            loanId={loan.id}
            canRequest={canRequestServiceActions}
            hasPendingDisbursement={hasPendingDisbursement}
            isOpenLoan={isOpenLoan}
            settlementAccounts={settlementAccounts}
            repaymentTransactions={repaymentTransactions}
            currencyCode={loan.denominationCurrency}
            requests={serviceRequests.map((item) => ({
              id: item.id,
              actionType: item.actionType,
              status: item.status,
              reason: item.reason,
              requestedByName: item.requestedBy.name,
              requestedAt: new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(item.requestedAt),
              decidedByName: item.decidedBy?.name ?? null,
              decidedAt: item.decidedAt ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(item.decidedAt) : null,
              decisionNote: item.decisionNote,
              canDecide: item.status === "PENDING" && item.requestedById !== session.user.id,
              isOwnRequest: item.requestedById === session.user.id,
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
                    const paid =
                      item.principalPaidMinor +
                      item.interestPaidMinor +
                      item.feesPaidMinor +
                      item.penaltiesPaidMinor;
                    const rowOutstanding = installmentOutstandingMinor(item);
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
                          {formatMinor(rowOutstanding, loan.denominationCurrency)}
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
              <table className="clickable-rows">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Channel</th>
                    <th>Amount</th>
                    <th>Reference</th>
                    <th>Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {loan.transactions.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.businessDate.toLocaleDateString()}
                        <Link className="row-link" href={`/loans/${loan.id}/transactions/${item.id}`} aria-label={`Open ${item.transactionType.replaceAll("_", " ").toLowerCase()} transaction`} />
                      </td>
                      <td>{item.transactionType}</td>
                      <td>{item.settlementChannel}</td>
                      <td>
                        {formatMinor(item.denominationAmountMinor, loan.denominationCurrency)}
                      </td>
                      <td>{item.externalReference ?? "-"}</td>
                      <td>{item.recordedBy?.name ?? "-"}</td>
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

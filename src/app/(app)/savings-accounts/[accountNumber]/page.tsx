import { AlertCircle, PiggyBank, ReceiptText } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

const dateFormatter = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-UG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Kampala",
});

function fullName(person: { firstName: string; middleName: string | null; lastName: string }) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ");
}

function statusTone(status: string) {
  return status === "ACTIVE" ? "up-to-date" : "review";
}

function statusLabel(status: string) {
  return status === "SUBMITTED" ? "Pending approval" : status.replaceAll("_", " ");
}

function accountTypeLabel(accountType: string) {
  return accountType.replaceAll("_", " ");
}

function snapshotRecord(snapshot: Prisma.JsonValue | null) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot as Record<string, Prisma.JsonValue>;
}

function snapshotString(snapshot: Prisma.JsonValue | null, key: string) {
  const value = snapshotRecord(snapshot)?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function snapshotBigInt(snapshot: Prisma.JsonValue | null, key: string) {
  const value = snapshotRecord(snapshot)?.[key];
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  return null;
}

function snapshotNumber(snapshot: Prisma.JsonValue | null, key: string) {
  const value = snapshotRecord(snapshot)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default async function SavingsAccountDetailPage({
  params,
}: {
  params: Promise<{ accountNumber: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const clientScope: Prisma.ClientWhereInput = {
    organizationId: scope.organizationId,
    ...officeWhere(scope),
  };
  const groupScope: Prisma.GroupWhereInput = {
    organizationId: scope.organizationId,
    ...officeWhere(scope),
  };

  const { accountNumber } = await params;
  const account = await prisma.savingsAccount.findFirst({
    where: {
      accountNumber,
      OR: [{ client: { is: clientScope } }, { group: { is: groupScope } }],
    },
    include: {
      client: {
        select: {
          accountNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          assignedOfficer: { select: { name: true } },
          office: { select: { name: true } },
        },
      },
      group: {
        select: {
          accountNumber: true,
          name: true,
          assignedOfficer: { select: { name: true } },
          office: { select: { name: true } },
        },
      },
      product: {
        select: {
          name: true,
          shortName: true,
          currencyCode: true,
          nominalAnnualRateBps: true,
          minOpeningBalanceMinor: true,
        },
      },
      fieldOfficer: { select: { name: true } },
      submittedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      transactions: { orderBy: { createdAt: "desc" } },
      charges: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!account) notFound();

  const owner = account.client
    ? {
        kind: "client" as const,
        name: fullName(account.client),
        accountNumber: account.client.accountNumber,
        href: `/clients/${account.client.accountNumber}`,
        officeName: account.client.office.name,
        assignedOfficerName: account.client.assignedOfficer?.name ?? null,
      }
    : account.group
      ? {
          kind: "group" as const,
          name: account.group.name,
          accountNumber: account.group.accountNumber,
          href: `/groups/${account.group.accountNumber}`,
          officeName: account.group.office.name,
          assignedOfficerName: account.group.assignedOfficer?.name ?? null,
        }
      : notFound();

  const productName = account.product?.name ?? snapshotString(account.termsSnapshot, "name") ?? "Unlinked product";
  const productCode = account.product?.shortName ?? snapshotString(account.termsSnapshot, "shortName");
  const nominalAnnualRateBps = account.product?.nominalAnnualRateBps ?? snapshotNumber(account.termsSnapshot, "nominalAnnualRateBps");
  const minimumOpeningBalanceMinor =
    account.product?.minOpeningBalanceMinor ?? snapshotBigInt(account.termsSnapshot, "minOpeningBalanceMinor");
  const balanceMinor = account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
  const depositsMinor = account.transactions.reduce(
    (sum, transaction) => sum + (transaction.amountMinor > 0n ? transaction.amountMinor : 0n),
    0n,
  );
  const withdrawalsMinor = account.transactions.reduce(
    (sum, transaction) => sum + (transaction.amountMinor < 0n ? -transaction.amountMinor : 0n),
    0n,
  );
  const pendingChargesMinor = account.charges.reduce(
    (sum, charge) => sum + (charge.status === "PENDING" ? charge.amountMinor : 0n),
    0n,
  );
  const savingsOfficer = account.fieldOfficer?.name ?? owner.assignedOfficerName ?? "Unassigned";

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Savings accounts", href: "/savings-accounts" },
          { label: account.accountNumber },
        ]}
      />
      <header className="client-header">
        <span className="client-photo client-photo-placeholder">
          <PiggyBank size={22} />
        </span>
        <div>
          <h1>
            {account.accountNumber}
            <span className={`wallet-balance ${balanceMinor < 0n ? "negative" : ""}`}>
              {formatMinor(balanceMinor, account.currencyCode)}
            </span>
          </h1>
          <p>
            Holder:{" "}
            <Link className="green-link" href={owner.href}>
              {owner.name}
            </Link>{" "}
            {owner.kind === "group" ? <span className="status review">Group</span> : null}
            {" | "}Product: {productName} | Office: {owner.officeName}
          </p>
        </div>
        <span className={`status-dot ${statusTone(account.status)}`} />
      </header>

      <section className="loan-summary-metrics" aria-label="Savings account summary">
        <article>
          <span>Current balance</span>
          <strong>{formatMinor(balanceMinor, account.currencyCode)}</strong>
        </article>
        <article>
          <span>Total deposits</span>
          <strong>{formatMinor(depositsMinor, account.currencyCode)}</strong>
        </article>
        <article>
          <span>Total withdrawals</span>
          <strong>{formatMinor(withdrawalsMinor, account.currencyCode)}</strong>
        </article>
        <article>
          <span>Pending charges</span>
          <strong>{formatMinor(pendingChargesMinor, account.currencyCode)}</strong>
        </article>
      </section>

      <div className="loan-route-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>General information</h2>
              <p>
                {owner.kind === "group" ? "Group-owned" : "Client-owned"} savings account within your scoped office
                portfolio
              </p>
            </div>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Account holder</dt>
              <dd>
                <Link className="green-link" href={owner.href}>
                  {owner.name}
                </Link>
                {owner.kind === "group" ? <> <span className="status review">Group</span></> : null}
              </dd>
            </div>
            <div>
              <dt>{owner.kind === "group" ? "Group account" : "Client account"}</dt>
              <dd className="mono">{owner.accountNumber}</dd>
            </div>
            <div>
              <dt>Account type</dt>
              <dd>{accountTypeLabel(account.accountType)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`status ${statusTone(account.status)}`}>{statusLabel(account.status)}</span>
              </dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd>{productName}</dd>
            </div>
            <div>
              <dt>Product code</dt>
              <dd>{productCode ?? "—"}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{account.currencyCode}</dd>
            </div>
            <div>
              <dt>Office</dt>
              <dd>{owner.officeName}</dd>
            </div>
            <div>
              <dt>Savings officer</dt>
              <dd>{savingsOfficer}</dd>
            </div>
            <div>
              <dt>External ID</dt>
              <dd>{account.externalId ?? "None"}</dd>
            </div>
            <div>
              <dt>Opened on</dt>
              <dd>{account.submittedOn ? dateFormatter.format(account.submittedOn) : dateFormatter.format(account.createdAt)}</dd>
            </div>
            <div>
              <dt>Activated on</dt>
              <dd>{account.approvedOn ? dateFormatter.format(account.approvedOn) : "Not activated"}</dd>
            </div>
            <div>
              <dt>Submitted by</dt>
              <dd>{account.submittedBy?.name ?? "System"}</dd>
            </div>
            <div>
              <dt>Approved by</dt>
              <dd>{account.approvedBy?.name ?? "Pending approval"}</dd>
            </div>
            <div>
              <dt>Nominal annual rate</dt>
              <dd>{nominalAnnualRateBps === null ? "—" : `${(nominalAnnualRateBps / 100).toFixed(2)}%`}</dd>
            </div>
            <div>
              <dt>Minimum opening balance</dt>
              <dd>{minimumOpeningBalanceMinor === null ? "—" : formatMinor(minimumOpeningBalanceMinor, account.currencyCode)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Transactions</h2>
              <p>{account.transactions.length} posted entr{account.transactions.length === 1 ? "y" : "ies"} on this account</p>
            </div>
          </div>
          {account.transactions.length === 0 ? (
            <div className="empty-state compact-empty">
              <PiggyBank size={26} />
              <strong>No savings transactions yet</strong>
              <p>Deposits and withdrawals will appear here after they are recorded.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Recorded</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {account.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{dateTimeFormatter.format(transaction.createdAt)}</td>
                      <td>
                        <span className={`status ${transaction.amountMinor >= 0n ? "up-to-date" : "review"}`}>
                          {transaction.transactionType.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="mono">{formatMinor(transaction.amountMinor, account.currencyCode)}</td>
                      <td>{transaction.externalReference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Charges</h2>
              <p>Account-opening and servicing charges attached to this savings account</p>
            </div>
          </div>
          {account.charges.length === 0 ? (
            <div className="empty-state compact-empty">
              <ReceiptText size={26} />
              <strong>No charges on this account</strong>
              <p>Applied charges will appear here when configured during account opening or servicing.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Charge</th>
                    <th>Status</th>
                    <th>Due date</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {account.charges.map((charge) => (
                    <tr key={charge.id}>
                      <td>{charge.name}</td>
                      <td>
                        <span className={`status ${charge.status === "PAID" ? "up-to-date" : "review"}`}>
                          {charge.status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>{charge.dueOn ? dateFormatter.format(charge.dueOn) : "—"}</td>
                      <td className="mono">{formatMinor(charge.amountMinor, charge.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {account.status !== "ACTIVE" ? (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Activation status</h2>
                <p>This account cannot take transactions until it is active</p>
              </div>
            </div>
            <div className="empty-state compact-empty">
              <AlertCircle size={26} />
              <strong>{statusLabel(account.status)}</strong>
              <p>
                Submitted accounts need maker-checker approval before deposits and withdrawals can be posted.
              </p>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

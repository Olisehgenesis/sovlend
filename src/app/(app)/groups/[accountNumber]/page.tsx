import { CircleDollarSign, CircleUserRound, PiggyBank, StickyNote, Users } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { AddGroupMemberForm, AddGroupNoteForm } from "@/components/group-record-forms";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

const tabs = [
  { key: "general", label: "General", icon: CircleUserRound },
  { key: "members", label: "Members", icon: Users },
  { key: "savings", label: "Savings", icon: PiggyBank },
  { key: "loans", label: "Loans", icon: CircleDollarSign },
  { key: "notes", label: "Notes", icon: StickyNote },
] as const;

const ACTIVE_MEMBER_LOAN_STATUSES = new Set(["ACTIVE", "IN_ARREARS"]);

type TabKey = (typeof tabs)[number]["key"];

type NameRecord = {
  firstName: string;
  middleName: string | null;
  lastName: string;
};

function fullName(person: NameRecord) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ");
}

function savingsStatusTone(status: string) {
  return status === "ACTIVE" ? "up-to-date" : "review";
}

function savingsStatusLabel(status: string) {
  return status === "SUBMITTED" ? "Pending approval" : status.replaceAll("_", " ");
}

function savingsAccountTypeLabel(accountType: string) {
  return accountType.replaceAll("_", " ");
}

function outstandingPrincipalMinor(installments: Array<{ principalDueMinor: bigint; principalPaidMinor: bigint; principalWaivedMinor: bigint }>) {
  return installments.reduce((sum, installment) => {
    const outstanding = installment.principalDueMinor - installment.principalPaidMinor - installment.principalWaivedMinor;
    return sum + (outstanding > 0n ? outstanding : 0n);
  }, 0n);
}

export default async function GroupDetailPage({ params, searchParams }: { params: Promise<{ accountNumber: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const { accountNumber } = await params;
  const tab = (await searchParams).tab as TabKey | undefined;
  const activeTab: TabKey = tabs.some((item) => item.key === tab) ? (tab as TabKey) : "general";

  const group = await prisma.group.findFirst({
    where: { accountNumber, organizationId: scope.organizationId, ...officeWhere(scope) },
    include: {
      office: { select: { name: true } },
      assignedOfficer: { select: { name: true } },
      members: {
        orderBy: { createdAt: "desc" },
        include: {
          client: {
            select: {
              accountNumber: true,
              firstName: true,
              middleName: true,
              lastName: true,
              status: true,
            },
          },
        },
      },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      loans: { orderBy: { createdAt: "desc" }, include: { product: true } },
      savingsAccounts: {
        orderBy: { createdAt: "desc" },
        include: {
          product: { select: { name: true, shortName: true } },
          transactions: { select: { amountMinor: true } },
        },
      },
      loanApplications: { where: { status: { in: ["SUBMITTED", "APPROVED"] } }, orderBy: { createdAt: "desc" }, include: { product: true } },
    },
  });
  if (!group) notFound();

  const memberClientIds = group.members.map((member) => member.clientId);
  const [memberLoans, memberSavingsAccounts] = await Promise.all([
    prisma.loan.findMany({
      where: { clientId: { in: memberClientIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        clientId: true,
        accountNumber: true,
        denominationCurrency: true,
        principalMinor: true,
        status: true,
        product: { select: { name: true } },
        client: { select: { accountNumber: true, firstName: true, middleName: true, lastName: true } },
        installments: { select: { principalDueMinor: true, principalPaidMinor: true, principalWaivedMinor: true } },
      },
    }),
    prisma.savingsAccount.findMany({
      where: { clientId: { in: memberClientIds } },
      select: {
        clientId: true,
        currencyCode: true,
        transactions: { select: { amountMinor: true } },
      },
    }),
  ]);

  const memberLoanSummary = new Map<string, { activeLoanCount: number; outstandingPrincipalMinor: bigint; currencyCode: string }>();
  for (const loan of memberLoans) {
    if (!loan.clientId) continue;
    const summary = memberLoanSummary.get(loan.clientId) ?? { activeLoanCount: 0, outstandingPrincipalMinor: 0n, currencyCode: loan.denominationCurrency };
    if (ACTIVE_MEMBER_LOAN_STATUSES.has(loan.status)) {
      summary.activeLoanCount += 1;
      summary.outstandingPrincipalMinor += outstandingPrincipalMinor(loan.installments);
    }
    memberLoanSummary.set(loan.clientId, summary);
  }

  const memberSavingsSummary = new Map<string, { accountCount: number; totalBalanceMinor: bigint; currencyCode: string }>();
  for (const account of memberSavingsAccounts) {
    if (!account.clientId) continue;
    const summary = memberSavingsSummary.get(account.clientId) ?? { accountCount: 0, totalBalanceMinor: 0n, currencyCode: account.currencyCode };
    summary.accountCount += 1;
    summary.totalBalanceMinor += account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
    memberSavingsSummary.set(account.clientId, summary);
  }

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Groups", href: "/groups" }, { label: group.name }]} />
      <header className="client-header">
        <span className={`status-dot ${group.status === "ACTIVE" ? "up-to-date" : "review"}`} />
        <div>
          <h1>{group.name}</h1>
          <p>
            Account #: <span className="mono">{group.accountNumber}</span> | Office: {group.office.name} | Staff: {group.assignedOfficer?.name ?? "Unassigned"}
          </p>
        </div>
      </header>

      <nav className="client-tabs" aria-label="Group record sections">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <Link className={activeTab === item.key ? "active" : ""} href={`/groups/${group.accountNumber}?tab=${item.key}`} key={item.key}>
              <Icon size={15} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {activeTab === "general" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>General information</h2>
              <p>Groups mostly organize members, but they can also directly hold savings or loan accounts when needed.</p>
            </div>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Office</dt>
              <dd>{group.office.name}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><span className={`status ${group.status === "ACTIVE" ? "up-to-date" : "review"}`}>{group.status}</span></dd>
            </div>
            <div>
              <dt>External ID</dt>
              <dd>{group.externalId ?? "None"}</dd>
            </div>
            <div>
              <dt>Staff</dt>
              <dd>{group.assignedOfficer?.name ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Submitted on</dt>
              <dd>{group.submittedOn ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(group.submittedOn) : "—"}</dd>
            </div>
            <div>
              <dt>Activation date</dt>
              <dd>{group.activatedOn ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(group.activatedOn) : "Not activated"}</dd>
            </div>
            <div>
              <dt>Active members</dt>
              <dd>{group.members.length}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {activeTab === "members" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Members</h2>
              <p>Each member keeps their own loans and savings accounts; the group helps organize collections.</p>
            </div>
          </div>
          {group.members.length === 0 ? (
            <div className="empty-state compact-empty">
              <Users size={26} />
              <strong>No members yet</strong>
              <p>Add a client by account number below.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="clickable-rows">
                <thead>
                  <tr>
                    <th>Account #</th>
                    <th>Member</th>
                    <th>Status</th>
                    <th>Loans</th>
                    <th>Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {group.members.map((member) => {
                    const loanSummary = memberLoanSummary.get(member.clientId) ?? { activeLoanCount: 0, outstandingPrincipalMinor: 0n, currencyCode: "UGX" };
                    const savingsSummary = memberSavingsSummary.get(member.clientId) ?? { accountCount: 0, totalBalanceMinor: 0n, currencyCode: "UGX" };
                    const memberName = fullName(member.client);
                    return (
                      <tr key={member.id}>
                        <td className="mono">{member.client.accountNumber}</td>
                        <td>
                          <strong>{memberName}</strong>
                          <Link className="row-link" href={`/clients/${member.client.accountNumber}`} aria-label={`Open ${memberName}`} />
                        </td>
                        <td><span className={`status ${member.client.status === "ACTIVE" ? "up-to-date" : "review"}`}>{member.client.status}</span></td>
                        <td>
                          <strong>{loanSummary.activeLoanCount} active loan{loanSummary.activeLoanCount === 1 ? "" : "s"}</strong>
                          <br />
                          <small>{formatMinor(loanSummary.outstandingPrincipalMinor, loanSummary.currencyCode)} outstanding</small>
                        </td>
                        <td>
                          <strong>{savingsSummary.accountCount} account{savingsSummary.accountCount === 1 ? "" : "s"}</strong>
                          <br />
                          <small>{formatMinor(savingsSummary.totalBalanceMinor, savingsSummary.currencyCode)} balance</small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <AddGroupMemberForm groupId={group.id} />
        </section>
      ) : null}

      {activeTab === "savings" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Group savings</h2>
              <p>These are savings accounts owned by the group itself, separate from the members&apos; personal savings on the Members tab.</p>
            </div>
          </div>
          {group.savingsAccounts.length === 0 ? (
            <div className="empty-state compact-empty">
              <PiggyBank size={26} />
              <strong>No direct group-owned savings accounts yet</strong>
              <p>Any savings account opened in the group&apos;s own name will appear here separately from members&apos; personal savings.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="clickable-rows">
                <thead>
                  <tr>
                    <th>Account #</th>
                    <th>Product</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Balance</th>
                    <th>Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {group.savingsAccounts.map((account) => {
                    const balanceMinor = account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
                    return (
                      <tr key={account.id}>
                        <td className="mono">
                          {account.accountNumber}
                          <Link className="row-link" href={`/savings-accounts/${account.accountNumber}`} aria-label={`Open savings account ${account.accountNumber}`} />
                        </td>
                        <td>{account.product?.name ?? "Unlinked product"}</td>
                        <td>{savingsAccountTypeLabel(account.accountType)}</td>
                        <td>
                          <span className={`status ${savingsStatusTone(account.status)}`}>{savingsStatusLabel(account.status)}</span>
                        </td>
                        <td className="mono">{formatMinor(balanceMinor, account.currencyCode)}</td>
                        <td>{account.currencyCode}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "loans" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Loans</h2>
              <p>Borrowing activity is usually held by individual members; rare true group-owned accounts stay separate below.</p>
            </div>
            <Link className="secondary-action" href={`/loans/new?groupId=${group.id}`}>
              New loan application
            </Link>
          </div>

          {memberLoans.length === 0 && group.loans.length === 0 && group.loanApplications.length === 0 ? (
            <div className="empty-state compact-empty">
              <CircleDollarSign size={26} />
              <strong>No loans yet</strong>
              <p>No member loans, group-owned loans, or pending group applications are on record.</p>
            </div>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <h2>Member loans</h2>
                  <p>Loans owned by the current members of this group.</p>
                </div>
              </div>
              {memberLoans.length === 0 ? (
                <div className="empty-state compact-empty">
                  <PiggyBank size={26} />
                  <strong>No member loans yet</strong>
                  <p>Members&apos; individual loan accounts will appear here once applied for or disbursed.</p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="clickable-rows">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Client #</th>
                        <th>Loan #</th>
                        <th>Product</th>
                        <th>Status</th>
                        <th>Outstanding principal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberLoans.map((loan) => {
                        const ownerName = loan.client ? fullName(loan.client) : "Former member";
                        const principalOutstanding = outstandingPrincipalMinor(loan.installments);
                        return (
                          <tr key={loan.id}>
                            <td>
                              <strong>{ownerName}</strong>
                              <Link className="row-link" href={`/loans/${loan.id}`} aria-label={`Open loan ${loan.accountNumber}`} />
                            </td>
                            <td className="mono">{loan.client?.accountNumber ?? "—"}</td>
                            <td className="mono">{loan.accountNumber}</td>
                            <td>{loan.product.name}</td>
                            <td><span className={`status ${loan.status === "ACTIVE" ? "up-to-date" : loan.status === "IN_ARREARS" ? "in-arrears" : "review"}`}>{loan.status.replaceAll("_", " ")}</span></td>
                            <td>{formatMinor(principalOutstanding, loan.denominationCurrency)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {group.loans.length > 0 ? (
                <>
                  <div className="panel-heading">
                    <div>
                      <h2>Direct group-owned loans</h2>
                      <p>These uncommon records are attached to the group entity itself rather than an individual member.</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="clickable-rows">
                      <thead>
                        <tr>
                          <th>Loan #</th>
                          <th>Product</th>
                          <th>Status</th>
                          <th>Principal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.loans.map((loan) => (
                          <tr key={loan.id}>
                            <td className="mono">
                              {loan.accountNumber}
                              <Link className="row-link" href={`/loans/${loan.id}`} aria-label={`Open loan ${loan.accountNumber}`} />
                            </td>
                            <td>{loan.product.name}</td>
                            <td><span className={`status ${loan.status === "ACTIVE" ? "up-to-date" : loan.status === "IN_ARREARS" ? "in-arrears" : "review"}`}>{loan.status.replaceAll("_", " ")}</span></td>
                            <td>{formatMinor(loan.principalMinor, loan.denominationCurrency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {group.loanApplications.length > 0 ? (
                <>
                  <div className="panel-heading">
                    <div>
                      <h2>Pending group applications</h2>
                      <p>Applications submitted in the group&apos;s own name.</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="clickable-rows">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Product</th>
                          <th>Principal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.loanApplications.map((application) => (
                          <tr key={application.id}>
                            <td className="mono">
                              {application.status}
                              <Link className="row-link" href={`/loans/applications/${application.id}`} aria-label={`Open ${application.product.name} application`} />
                            </td>
                            <td>{application.product.name}</td>
                            <td>{formatMinor(application.proposedPrincipalMinor, application.product.denominationCurrency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          )}
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
          {group.notes.length === 0 ? (
            <div className="empty-state compact-empty">
              <StickyNote size={26} />
              <strong>No notes yet</strong>
              <p>Leave context for other staff working with this group.</p>
            </div>
          ) : (
            <ul className="note-list">
              {group.notes.map((note) => (
                <li key={note.id}>
                  <p>{note.body}</p>
                  <small>{note.author.name} · {new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(note.createdAt)}</small>
                </li>
              ))}
            </ul>
          )}
          <AddGroupNoteForm groupId={group.id} />
        </section>
      ) : null}
    </main>
  );
}

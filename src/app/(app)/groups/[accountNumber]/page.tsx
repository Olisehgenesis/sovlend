import { AlertTriangle, CircleDollarSign, CircleUserRound, PiggyBank, StickyNote, Users } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { EntityAvatar } from "@/components/entity-avatar";
import { AddGroupMemberForm, AddGroupNoteForm } from "@/components/group-record-forms";
import { StaffAssignment } from "@/components/loan-officer-assignment";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, groupScopeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { STAFF_SYSTEM_ROLES } from "@/modules/identity/domain/staff-roles";
import { installmentOutstandingMinor } from "@/modules/lending/domain/loan-outstanding";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { displaySavingsProductName } from "@/modules/savings/domain/savings-product-label";

const tabs = [
  { key: "general", label: "General", icon: CircleUserRound },
  { key: "members", label: "Members", icon: Users },
  { key: "arrears", label: "Arrears", icon: AlertTriangle },
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

type OpenInstallment = {
  installmentNumber: number;
  dueOn: Date;
  principalDueMinor: bigint;
  principalPaidMinor: bigint;
  principalWaivedMinor: bigint;
  interestDueMinor: bigint;
  interestPaidMinor: bigint;
  interestWaivedMinor: bigint;
  feesDueMinor: bigint;
  feesPaidMinor: bigint;
  feesWaivedMinor: bigint;
  penaltiesDueMinor: bigint;
  penaltiesPaidMinor: bigint;
  penaltiesWaivedMinor: bigint;
  monitoringFeeDueMinor: bigint;
  monitoringFeePaidMinor: bigint;
  monitoringFeeWaivedMinor: bigint;
};

function outstandingPrincipalMinor(
  installments: Array<{ principalDueMinor: bigint; principalPaidMinor: bigint; principalWaivedMinor: bigint }>,
  principalWrittenOffMinor: bigint = 0n,
) {
  const dueOutstanding = installments.reduce((sum, installment) => {
    const outstanding = installment.principalDueMinor - installment.principalPaidMinor - installment.principalWaivedMinor;
    return sum + (outstanding > 0n ? outstanding : 0n);
  }, 0n);
  const outstanding = dueOutstanding - principalWrittenOffMinor;
  return outstanding > 0n ? outstanding : 0n;
}

function utcDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function arrearsOutstandingMinor(installments: readonly OpenInstallment[], asOf: Date) {
  const asOfDay = utcDay(asOf);
  return installments.reduce((sum, installment) => {
    if (utcDay(installment.dueOn) >= asOfDay) return sum;
    return sum + installmentOutstandingMinor(installment);
  }, 0n);
}

function nextCollectionOn(installments: readonly OpenInstallment[]) {
  const next = [...installments]
    .filter((installment) => installmentOutstandingMinor(installment) > 0n)
    .sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime() || left.installmentNumber - right.installmentNumber)[0];
  return next?.dueOn ?? null;
}

function earlierDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() <= right.getTime() ? left : right;
}

function formatGroupDate(date: Date) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

const openInstallmentSelect = {
  installmentNumber: true,
  dueOn: true,
  principalDueMinor: true,
  principalPaidMinor: true,
  principalWaivedMinor: true,
  interestDueMinor: true,
  interestPaidMinor: true,
  interestWaivedMinor: true,
  feesDueMinor: true,
  feesPaidMinor: true,
  feesWaivedMinor: true,
  penaltiesDueMinor: true,
  penaltiesPaidMinor: true,
  penaltiesWaivedMinor: true,
  monitoringFeeDueMinor: true,
  monitoringFeePaidMinor: true,
  monitoringFeeWaivedMinor: true,
} as const;

export default async function GroupDetailPage({ params, searchParams }: { params: Promise<{ accountNumber: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const { accountNumber } = await params;
  const tab = (await searchParams).tab as TabKey | undefined;
  const activeTab: TabKey = tabs.some((item) => item.key === tab) ? (tab as TabKey) : "general";

  const group = await prisma.group.findFirst({
    where: { accountNumber, organizationId: scope.organizationId, ...groupScopeWhere(scope) },
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
              genderCode: true,
              middleName: true,
              lastName: true,
              photoDocumentId: true,
              status: true,
            },
          },
        },
      },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      loans: { where: { clientId: null }, orderBy: { createdAt: "desc" }, include: { product: true, installments: { select: openInstallmentSelect } } },
      savingsAccounts: {
        orderBy: { createdAt: "desc" },
        include: {
          product: { select: { name: true, shortName: true } },
          transactions: { select: { amountMinor: true } },
        },
      },
      loanApplications: { where: { status: { in: ["SUBMITTED", "APPROVED"] } }, orderBy: { createdAt: "desc" }, include: { product: true, client: { select: { firstName: true, middleName: true, lastName: true, accountNumber: true } } } },
    },
  });
  if (!group) notFound();

  const memberClientIds = group.members.map((member) => member.clientId);
  const pendingMemberApplications = group.loanApplications.filter((application) => application.clientId);
  const pendingGroupApplications = group.loanApplications.filter((application) => !application.clientId);
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
        installments: { select: openInstallmentSelect },
        principalWrittenOffMinor: true,
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

  const today = new Date();
  const memberLoanSummary = new Map<
    string,
    {
      activeLoanCount: number;
      outstandingPrincipalMinor: bigint;
      currencyCode: string;
      inArrears: boolean;
      arrearsMinor: bigint;
      nextCollectionOn: Date | null;
    }
  >();
  for (const loan of memberLoans) {
    if (!loan.clientId) continue;
    const summary = memberLoanSummary.get(loan.clientId) ?? {
      activeLoanCount: 0,
      outstandingPrincipalMinor: 0n,
      currencyCode: loan.denominationCurrency,
      inArrears: false,
      arrearsMinor: 0n,
      nextCollectionOn: null,
    };
    if (ACTIVE_MEMBER_LOAN_STATUSES.has(loan.status)) {
      summary.activeLoanCount += 1;
      summary.outstandingPrincipalMinor += outstandingPrincipalMinor(loan.installments, loan.principalWrittenOffMinor);
      const loanArrears = arrearsOutstandingMinor(loan.installments, today);
      summary.arrearsMinor += loanArrears;
      if (loan.status === "IN_ARREARS" || loanArrears > 0n) summary.inArrears = true;
      summary.nextCollectionOn = earlierDate(summary.nextCollectionOn, nextCollectionOn(loan.installments));
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

  // Group-level status card totals: members' own accounts plus any rare accounts held directly by the group.
  const groupOwnedSavingsMinor = group.savingsAccounts.reduce(
    (sum, account) => sum + account.transactions.reduce((accSum, transaction) => accSum + transaction.amountMinor, 0n),
    0n,
  );
  const groupOwnedLoanOutstandingMinor = group.loans.reduce(
    (sum, loan) => sum + (ACTIVE_MEMBER_LOAN_STATUSES.has(loan.status) ? outstandingPrincipalMinor(loan.installments, loan.principalWrittenOffMinor) : 0n),
    0n,
  );
  const groupOwnedActiveLoanCount = group.loans.filter((loan) => ACTIVE_MEMBER_LOAN_STATUSES.has(loan.status)).length;
  const groupOwnedArrearsMinor = group.loans.reduce(
    (sum, loan) => sum + (ACTIVE_MEMBER_LOAN_STATUSES.has(loan.status) ? arrearsOutstandingMinor(loan.installments, today) : 0n),
    0n,
  );
  const groupOwnedNextCollection = group.loans.reduce<Date | null>((soonest, loan) => {
    if (!ACTIVE_MEMBER_LOAN_STATUSES.has(loan.status)) return soonest;
    return earlierDate(soonest, nextCollectionOn(loan.installments));
  }, null);

  const memberSavingsMinor = [...memberSavingsSummary.values()].reduce((sum, summary) => sum + summary.totalBalanceMinor, 0n);
  const memberSavingsAccountCount = [...memberSavingsSummary.values()].reduce((sum, summary) => sum + summary.accountCount, 0);
  const totalSavingsMinor = memberSavingsMinor + groupOwnedSavingsMinor;
  const totalActiveLoans = [...memberLoanSummary.values()].reduce((sum, summary) => sum + summary.activeLoanCount, 0) + groupOwnedActiveLoanCount;
  const membersInArrears = group.members.filter((member) => memberLoanSummary.get(member.clientId)?.inArrears).length;
  const totalArrearsMinor = [...memberLoanSummary.values()].reduce((sum, summary) => sum + summary.arrearsMinor, 0n) + groupOwnedArrearsMinor;
  const nextGroupCollection = [...memberLoanSummary.values()].reduce<Date | null>(
    (soonest, summary) => earlierDate(soonest, summary.nextCollectionOn),
    groupOwnedNextCollection,
  );
  const totalSavingsAccountCount = memberSavingsAccountCount + group.savingsAccounts.length;
  const summaryCurrencyCode =
    group.savingsAccounts[0]?.currencyCode ??
    memberSavingsAccounts[0]?.currencyCode ??
    memberLoans[0]?.denominationCurrency ??
    group.loans[0]?.denominationCurrency ??
    "UGX";

  const authorization = new AuthorizationService(prisma);
  const [canManage, officeStaff] = await Promise.all([
    authorization.isAllowed({
      actorUserId: session.user.id,
      permission: permissions.clientManage,
      organizationId: scope.organizationId,
      officeId: group.officeId,
    }),
    prisma.user.findMany({
      where: {
        organizationId: scope.organizationId,
        OR: [
          ...(group.staffId ? [{ id: group.staffId }] : []),
          { officeId: group.officeId, systemRole: { in: [...STAFF_SYSTEM_ROLES] } },
        ],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

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

      <section className="loan-summary-metrics group-summary-metrics" aria-label="Group summary">
        <article>
          <span>Total Members</span>
          <strong>{group.members.length.toLocaleString()}</strong>
        </article>
        <article>
          <span>Members in arrears</span>
          <strong className={membersInArrears > 0 ? "is-arrears" : undefined}>{membersInArrears.toLocaleString()}</strong>
        </article>
        <article>
          <span>Arrears</span>
          <strong className={totalArrearsMinor > 0n ? "is-arrears" : undefined}>
            {formatMinor(totalArrearsMinor, summaryCurrencyCode)}
          </strong>
        </article>
        <article>
          <span>Active Loans</span>
          <strong>{totalActiveLoans.toLocaleString()}</strong>
        </article>
        <article>
          <span>Total Savings</span>
          <strong>{formatMinor(totalSavingsMinor, summaryCurrencyCode)}</strong>
          <small>{totalSavingsAccountCount.toLocaleString()} account(s)</small>
        </article>
        <article>
          <span>Next collection</span>
          <strong>{nextGroupCollection ? formatGroupDate(nextGroupCollection) : "—"}</strong>
        </article>
      </section>

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
              <dd>
                {canManage ? (
                  <StaffAssignment
                    actionUrl={`/api/groups/${group.id}/assign-staff`}
                    currentOfficerId={group.staffId}
                    officers={officeStaff}
                    successMessage="Group staff updated"
                  />
                ) : (
                  group.assignedOfficer?.name ?? "Unassigned"
                )}
              </dd>
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
                    <th>Next collection</th>
                  </tr>
                </thead>
                <tbody>
                  {group.members.map((member) => {
                    const loanSummary = memberLoanSummary.get(member.clientId) ?? {
                      activeLoanCount: 0,
                      outstandingPrincipalMinor: 0n,
                      currencyCode: "UGX",
                      inArrears: false,
                      arrearsMinor: 0n,
                      nextCollectionOn: null,
                    };
                    const savingsSummary = memberSavingsSummary.get(member.clientId) ?? { accountCount: 0, totalBalanceMinor: 0n, currencyCode: "UGX" };
                    const memberName = fullName(member.client);
                    return (
                      <tr className={loanSummary.inArrears ? "member-in-arrears" : undefined} key={member.id}>
                        <td className="mono">{member.client.accountNumber}</td>
                        <td>
                          <div className="person-cell">
                            <EntityAvatar genderCode={member.client.genderCode} name={memberName} photoUrl={member.client.photoDocumentId ? `/api/documents/${member.client.photoDocumentId}` : null} seed={member.clientId} size={28} />
                            <span className="person-copy">
                              <strong>{memberName}</strong>
                              {loanSummary.inArrears ? <small className="arrears-mark">In arrears · {formatMinor(loanSummary.arrearsMinor, loanSummary.currencyCode)}</small> : null}
                            </span>
                            <Link className="row-link" href={`/clients/${member.client.accountNumber}`} aria-label={`Open ${memberName}`} />
                          </div>
                        </td>
                        <td>
                          <span className={`status ${loanSummary.inArrears ? "arrears-mark" : member.client.status === "ACTIVE" ? "up-to-date" : "review"}`}>
                            {loanSummary.inArrears ? "In arrears" : member.client.status}
                          </span>
                        </td>
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
                        <td>{loanSummary.nextCollectionOn ? formatGroupDate(loanSummary.nextCollectionOn) : "—"}</td>
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

      {activeTab === "arrears" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Arrears</h2>
              <p>
                {membersInArrears.toLocaleString()} member{membersInArrears === 1 ? "" : "s"} behind ·{" "}
                {formatMinor(totalArrearsMinor, summaryCurrencyCode)} overdue
                {nextGroupCollection ? ` · next collection ${formatGroupDate(nextGroupCollection)}` : ""}
              </p>
            </div>
          </div>
          {membersInArrears === 0 ? (
            <div className="empty-state compact-empty">
              <AlertTriangle size={26} />
              <strong>No members in arrears</strong>
              <p>Everyone in this group is current on their collections.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="clickable-rows">
                <thead>
                  <tr>
                    <th>Account #</th>
                    <th>Member</th>
                    <th>Arrears</th>
                    <th>Active loans</th>
                    <th>Next collection</th>
                  </tr>
                </thead>
                <tbody>
                  {group.members
                    .filter((member) => memberLoanSummary.get(member.clientId)?.inArrears)
                    .map((member) => {
                      const loanSummary = memberLoanSummary.get(member.clientId)!;
                      const memberName = fullName(member.client);
                      return (
                        <tr className="member-in-arrears" key={member.id}>
                          <td className="mono">{member.client.accountNumber}</td>
                          <td>
                            <div className="person-cell">
                              <EntityAvatar genderCode={member.client.genderCode} name={memberName} photoUrl={member.client.photoDocumentId ? `/api/documents/${member.client.photoDocumentId}` : null} seed={member.clientId} size={28} />
                              <span className="person-copy">
                                <strong>{memberName}</strong>
                                <small className="arrears-mark">In arrears</small>
                              </span>
                              <Link className="row-link" href={`/clients/${member.client.accountNumber}`} aria-label={`Open ${memberName}`} />
                            </div>
                          </td>
                          <td className="is-arrears">{formatMinor(loanSummary.arrearsMinor, loanSummary.currencyCode)}</td>
                          <td>{loanSummary.activeLoanCount}</td>
                          <td>{loanSummary.nextCollectionOn ? formatGroupDate(loanSummary.nextCollectionOn) : "—"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "savings" ? (
        <>
          <section className="loan-summary-metrics" aria-label="Group savings breakdown">
            <article>
              <span>Total Savings</span>
              <strong>{formatMinor(totalSavingsMinor, summaryCurrencyCode)}</strong>
              <small>{totalSavingsAccountCount.toLocaleString()} account(s)</small>
            </article>
            <article>
              <span>Members&apos; Savings</span>
              <strong>{formatMinor(memberSavingsMinor, summaryCurrencyCode)}</strong>
              <small>{memberSavingsAccountCount.toLocaleString()} account(s) &middot; see Members tab</small>
            </article>
            <article>
              <span>Group-Owned Savings</span>
              <strong>{formatMinor(groupOwnedSavingsMinor, summaryCurrencyCode)}</strong>
              <small>{group.savingsAccounts.length.toLocaleString()} account(s) &middot; listed below</small>
            </article>
          </section>

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
                          <td>{displaySavingsProductName(account.product?.name)}</td>
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
        </>
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

          {memberLoans.length === 0 && pendingMemberApplications.length === 0 && group.loans.length === 0 && pendingGroupApplications.length === 0 ? (
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
                        const principalOutstanding = outstandingPrincipalMinor(loan.installments, loan.principalWrittenOffMinor);
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

              {pendingMemberApplications.length > 0 ? (
                <>
                  <div className="panel-heading">
                    <div>
                      <h2>Pending member applications</h2>
                      <p>Group-originated applications still awaiting approval or disbursement for a selected member.</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="clickable-rows">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Client #</th>
                          <th>Status</th>
                          <th>Product</th>
                          <th>Principal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingMemberApplications.map((application) => (
                          <tr key={application.id}>
                            <td>
                              <strong>{application.client ? fullName(application.client) : "Member"}</strong>
                              <Link className="row-link" href={`/loans/applications/${application.id}`} aria-label={`Open ${application.product.name} application`} />
                            </td>
                            <td className="mono">{application.client?.accountNumber ?? "—"}</td>
                            <td>{application.status}</td>
                            <td>{application.product.name}</td>
                            <td>{formatMinor(application.proposedPrincipalMinor, application.product.denominationCurrency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

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

              {pendingGroupApplications.length > 0 ? (
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
                        {pendingGroupApplications.map((application) => (
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

import { CircleUserRound, Coins, FileText, IdCard, PiggyBank, StickyNote, Users, Wallet } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { AddChargeForm, ApplyForLoanButton, ApproveSavingsAccountButton, ChargesList, DepositWithdrawForm } from "@/components/client-account-panel";
import { ClientActionsMenu } from "@/components/client-actions-menu";
import { ClientQuickActions } from "@/components/client-quick-actions";
import { EntityAvatar } from "@/components/entity-avatar";
import { AddFamilyMemberForm, AddIdentifierForm, AddNoteForm, UploadDocumentForm } from "@/components/client-record-forms";
import { NewSavingsAccountWizard } from "@/components/new-savings-account-wizard";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { clientScopeWhere, getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { STAFF_SYSTEM_ROLES } from "@/modules/identity/domain/staff-roles";
import { getClientWalletSummary, OPEN_LOAN_STATUSES } from "@/modules/lending/application/client-wallet";
import { installmentDueMinor, installmentPaidMinor } from "@/modules/lending/domain/loan-outstanding";
import { formatMinor } from "@/modules/money/domain/format-minor";

const tabs = [
  { key: "general", label: "General", icon: CircleUserRound },
  { key: "loans", label: "Loans", icon: Wallet },
  { key: "savings", label: "Savings", icon: PiggyBank },
  { key: "charges", label: "Charges", icon: Coins },
  { key: "family", label: "Family Members", icon: Users },
  { key: "identities", label: "Identities", icon: IdCard },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "notes", label: "Notes", icon: StickyNote },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export default async function ClientDetailPage({ params, searchParams }: { params: Promise<{ accountNumber: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const { accountNumber } = await params;
  const tab = (await searchParams).tab as TabKey | undefined;
  const activeTab: TabKey = tabs.some((item) => item.key === tab) ? (tab as TabKey) : "general";

  const client = await prisma.client.findFirst({
    where: { accountNumber, organizationId: scope.organizationId, ...clientScopeWhere(scope) },
    include: {
      office: { select: { name: true } },
      assignedOfficer: { select: { name: true } },
      photoDocument: { select: { id: true, mediaType: true } },
      signatureDocument: { select: { id: true, mediaType: true } },
      familyMembers: { orderBy: { createdAt: "desc" }, include: { documents: { orderBy: { createdAt: "desc" } } } },
      identifiers: { orderBy: { createdAt: "desc" }, include: { documents: { orderBy: { createdAt: "desc" } } } },
      documents: { orderBy: { createdAt: "desc" } },
      loans: { orderBy: { createdAt: "desc" }, include: { product: { select: { name: true } }, installments: { select: { dueOn: true, principalDueMinor: true, principalPaidMinor: true, interestDueMinor: true, interestPaidMinor: true, feesDueMinor: true, feesPaidMinor: true, penaltiesDueMinor: true, penaltiesPaidMinor: true, monitoringFeeDueMinor: true, monitoringFeePaidMinor: true } } } },
      savingsAccounts: { orderBy: { createdAt: "desc" }, include: { product: { select: { name: true } }, transactions: { select: { amountMinor: true } } } },
      charges: { orderBy: { createdAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!client) notFound();

  const authorization = new AuthorizationService(prisma);
  const [canManage, canApplyLoan, canTransact, canRecordRepayment, canApproveSavings, wallet, savingsProducts, officers, savingsCharges, settlementAccounts] = await Promise.all([
    authorization.isAllowed({ actorUserId: session.user.id, permission: permissions.clientManage, organizationId: scope.organizationId, officeId: client.officeId }),
    authorization.isAllowed({ actorUserId: session.user.id, permission: permissions.loanApply, organizationId: scope.organizationId, officeId: client.officeId }),
    authorization.isAllowed({ actorUserId: session.user.id, permission: permissions.savingsTransact, organizationId: scope.organizationId, officeId: client.officeId }),
    authorization.isAllowed({ actorUserId: session.user.id, permission: permissions.loanRepayment, organizationId: scope.organizationId, officeId: client.officeId }),
    authorization.isAllowed({ actorUserId: session.user.id, permission: permissions.savingsApprove, organizationId: scope.organizationId, officeId: client.officeId }),
    getClientWalletSummary(prisma, client.id),
    prisma.savingsProduct.findMany({ where: { organizationId: scope.organizationId, active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { organizationId: scope.organizationId, officeId: client.officeId, systemRole: { in: [...STAFF_SYSTEM_ROLES] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.chargeDefinition.findMany({ where: { organizationId: scope.organizationId, appliesTo: "SAVINGS", active: true }, orderBy: { name: "asc" } }),
    prisma.settlementAccount.findMany({ where: { organizationId: scope.organizationId, active: true }, select: { id: true, name: true, type: true, provider: true, accountReference: true, currencyCode: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);

  const fullName = [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");
  const walletFormatted = formatMinor(wallet.netBalanceMinor, wallet.currencyCode);
  const idPhoto = client.identifiers.flatMap((identifier) => identifier.documents).find((document) => document.mediaType.startsWith("image/"));
  // `accountType` is a product category (e.g. "Individual"/"Group"), not a discriminator between
  // savings vs. other account kinds -- every row here already belongs to the SavingsAccount model.
  // Legacy-imported accounts never carry the value "SAVINGS", so filtering on it silently matched
  // zero accounts and hid Top up/Withdraw for every client. Filter on status alone.
  // A client can hold more than one active savings account (e.g. personal + group-linked) --
  // every one of them is offered to the record-payment/top-up/withdraw forms so an operator can
  // pick the right account instead of always landing on whichever one the query returns first.
  const activeSavingsAccounts = client.savingsAccounts.filter((account) => account.status === "ACTIVE");
  const savingsProductLabel = (account: { product: { name: string } | null; accountType: string }) => account.product?.name ?? account.accountType.replaceAll("_", " ");
  const savingsTargets = activeSavingsAccounts.map((account) => ({ id: account.id, accountNumber: account.accountNumber, currencyCode: account.currencyCode, productName: savingsProductLabel(account), isDefault: account.isDefault }));
  const businessDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  const loanRows = client.loans.map((loan) => {
    const totalPaidMinor = loan.installments.reduce(
      (sum, installment) => sum + installmentPaidMinor(installment),
      0n,
    );
    const interestOutstandingMinor = loan.installments.reduce(
      (sum, installment) => sum + (installment.interestDueMinor - installment.interestPaidMinor),
      0n,
    );
    const outstandingMinor = loan.installments.reduce(
      (sum, installment) => sum + installmentDueMinor(installment) - installmentPaidMinor(installment),
      0n,
    );
    const overdueOutstandingMinor = loan.installments.reduce((sum, installment) => {
      if (installment.dueOn >= businessDate) return sum;
      return sum + installmentDueMinor(installment) - installmentPaidMinor(installment);
    }, 0n);
    return { loan, totalPaidMinor, interestOutstandingMinor, outstandingMinor, overdueOutstandingMinor };
  });

  const savingsRows = client.savingsAccounts.map((account) => ({
    account,
    balanceMinor: account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n),
  }));
  // Same active savings accounts offered to Top up/Withdraw, but shaped for the Transfer form,
  // which needs each account's current balance to validate against and offer as "from".
  const transferSavingsAccounts = savingsRows
    .filter(({ account }) => account.status === "ACTIVE")
    .map(({ account, balanceMinor }) => ({
      id: account.id,
      accountNumber: account.accountNumber,
      currencyCode: account.currencyCode,
      productName: savingsProductLabel(account),
      balanceMinor: balanceMinor.toString(),
    }));

  const activeLoanCount = client.loans.filter((loan) => (OPEN_LOAN_STATUSES as readonly string[]).includes(loan.status)).length;
  const activeSavingsCount = client.savingsAccounts.filter((account) => account.status === "ACTIVE").length;
  const loanPaymentTargets = canRecordRepayment
    ? loanRows
        .filter(({ loan }) => (OPEN_LOAN_STATUSES as readonly string[]).includes(loan.status))
        .sort((left, right) => {
          const leftOverdue = left.overdueOutstandingMinor > 0n ? 1 : 0;
          const rightOverdue = right.overdueOutstandingMinor > 0n ? 1 : 0;
          if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
          if (left.overdueOutstandingMinor !== right.overdueOutstandingMinor) return left.overdueOutstandingMinor > right.overdueOutstandingMinor ? -1 : 1;
          if (left.outstandingMinor !== right.outstandingMinor) return left.outstandingMinor > right.outstandingMinor ? -1 : 1;
          return left.loan.accountNumber.localeCompare(right.loan.accountNumber);
        })
        .map(({ loan, outstandingMinor, overdueOutstandingMinor }) => ({
          id: loan.id,
          accountNumber: loan.accountNumber,
          productName: loan.product.name,
          currencyCode: loan.denominationCurrency,
          status: loan.status,
          outstandingMinor: outstandingMinor.toString(),
          overdueMinor: overdueOutstandingMinor.toString(),
        }))
    : [];

  // Nearest unpaid installment across the client's open loans, for the "next repayment due"
  // countdown badge. Flattens every open loan's outstanding installments rather than assuming a
  // single loan, since a client can hold more than one active loan at once.
  const nextRepayment = loanRows
    .filter(({ loan }) => (OPEN_LOAN_STATUSES as readonly string[]).includes(loan.status))
    .flatMap(({ loan }) =>
      loan.installments
        .filter((installment) => installmentDueMinor(installment) - installmentPaidMinor(installment) > 0n)
        .map((installment) => ({
          loanAccountNumber: loan.accountNumber,
          dueOn: installment.dueOn,
          outstandingMinor: installmentDueMinor(installment) - installmentPaidMinor(installment),
          currencyCode: loan.denominationCurrency,
        })),
    )
    .sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime())[0] ?? null;
  const daysUntilNextRepayment = nextRepayment ? Math.round((nextRepayment.dueOn.getTime() - businessDate.getTime()) / 86_400_000) : null;

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Clients", href: "/clients" }, { label: fullName }]} />
      <header className="client-header">
        <EntityAvatar className="client-photo" genderCode={client.genderCode} name={fullName} photoUrl={client.photoDocument ? `/api/documents/${client.photoDocument.id}` : null} seed={client.id} size={52} />
        <div>
          <h1>{fullName} <span className={`wallet-balance ${wallet.netBalanceMinor < 0n ? "negative" : ""}`}>{walletFormatted}</span></h1>
          <p>Client #: <span className="mono">{client.accountNumber}</span> | External id: {client.externalId ?? "None"} | Staff: {client.assignedOfficer?.name ?? "Unassigned"}</p>
          {nextRepayment && daysUntilNextRepayment !== null ? (
            <p className={`repayment-countdown ${daysUntilNextRepayment < 0 ? "overdue" : ""}`}>
              {daysUntilNextRepayment < 0
                ? `${Math.abs(daysUntilNextRepayment)} day${Math.abs(daysUntilNextRepayment) === 1 ? "" : "s"} overdue`
                : daysUntilNextRepayment === 0
                  ? "Due today"
                  : `Due in ${daysUntilNextRepayment} day${daysUntilNextRepayment === 1 ? "" : "s"}`}
              {" \u00b7 "}{nextRepayment.loanAccountNumber}{" \u00b7 "}{formatMinor(nextRepayment.outstandingMinor, nextRepayment.currencyCode)}{" \u00b7 "}
              {new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(nextRepayment.dueOn)}
            </p>
          ) : null}
        </div>
        <ClientQuickActions
          canRecordRepayment={canRecordRepayment}
          canTransact={canTransact}
          clientId={client.id}
          currentUserName={session.user.name ?? "Signed in user"}
          loanTargets={loanPaymentTargets}
          savingsTargets={canTransact ? savingsTargets : []}
          settlementAccounts={settlementAccounts}
          transferSavingsAccounts={canTransact ? transferSavingsAccounts : []}
        />
        <span className={`status-dot ${client.status === "ACTIVE" ? "up-to-date" : "review"}`} />
      </header>

      <section className="panel wallet-summary">
        <div className="panel-heading"><div><h2>Wallet</h2><p>Combined loan and savings position for this client</p></div></div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Accounts</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {savingsRows
                .filter(({ account }) => account.status === "ACTIVE")
                .map(({ account, balanceMinor }) => (
                  <tr key={account.id}>
                    <td>{savingsProductLabel(account)}</td>
                    <td className="mono">{account.accountNumber}</td>
                    <td>{formatMinor(balanceMinor, account.currencyCode)}</td>
                  </tr>
                ))}
              {activeSavingsCount > 1 ? (
                <tr className="wallet-subtotal-row">
                  <td>Savings subtotal</td>
                  <td>{activeSavingsCount.toLocaleString()} active of {client.savingsAccounts.length.toLocaleString()}</td>
                  <td>{formatMinor(wallet.savingsBalanceMinor, wallet.currencyCode)}</td>
                </tr>
              ) : null}
              <tr>
                <td>Loans</td>
                <td>{activeLoanCount.toLocaleString()} open of {client.loans.length.toLocaleString()}</td>
                <td>-{formatMinor(wallet.loanOutstandingMinor, wallet.currencyCode)}</td>
              </tr>
              <tr className="wallet-net-row">
                <td><strong>Net wallet balance</strong></td>
                <td></td>
                <td><strong className={wallet.netBalanceMinor < 0n ? "negative" : ""}>{walletFormatted}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="client-body">
        <div className="client-main">
          <nav className="client-tabs" aria-label="Client record sections">
            {tabs.map((item) => { const Icon = item.icon; return <Link className={activeTab === item.key ? "active" : ""} href={`/clients/${client.accountNumber}?tab=${item.key}`} key={item.key}><Icon size={15} />{item.label}</Link>; })}
          </nav>

      {activeTab === "general" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>General information</h2><p>Identity captured at onboarding</p></div></div>
          <dl className="detail-grid">
            <div><dt>Office</dt><dd>{client.office.name}</dd></div>
            <div><dt>Status</dt><dd><span className={`status ${client.status === "ACTIVE" ? "up-to-date" : "review"}`}>{client.status}</span></dd></div>
            <div><dt>Mobile number</dt><dd>{client.mobileNumber ?? "Not provided"}</dd></div>
            <div><dt>Date of birth</dt><dd>{client.dateOfBirth ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(client.dateOfBirth) : "Not provided"}</dd></div>
            <div><dt>Gender</dt><dd>{client.genderCode ?? "Not specified"}</dd></div>
            <div><dt>Client type</dt><dd>{client.clientTypeCode ?? "Not specified"}</dd></div>
            <div><dt>Classification</dt><dd>{client.classificationCode ?? "Not specified"}</dd></div>
            <div><dt>Is staff?</dt><dd>{client.isStaff ? "Yes" : "No"}</dd></div>
            <div><dt>Submitted on</dt><dd>{client.submittedOn ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(client.submittedOn) : "\u2014"}</dd></div>
            <div><dt>Activation date</dt><dd>{client.activatedOn ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(client.activatedOn) : "Not activated"}</dd></div>
            <div><dt>Savings balance</dt><dd>{formatMinor(wallet.savingsBalanceMinor, wallet.currencyCode)}</dd></div>
            <div><dt>Loan outstanding</dt><dd>{formatMinor(wallet.loanOutstandingMinor, wallet.currencyCode)}</dd></div>
          </dl>
          {idPhoto ? <div className="id-photo"><p className="eyebrow">ID photo on file</p><img alt="Identity document" src={`/api/documents/${idPhoto.id}`} /></div> : null}
          {client.signatureDocument ? <div className="id-photo"><p className="eyebrow">Signature on file</p><img alt="Client signature" src={`/api/documents/${client.signatureDocument.id}`} /></div> : null}
        </section>
      ) : null}

      {activeTab === "loans" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Loans</h2><p>Loan accounts held by this client</p></div>{canApplyLoan && client.status === "ACTIVE" ? <ApplyForLoanButton clientId={client.id} /> : null}</div>
          {client.loans.length === 0 ? <div className="empty-state compact-empty"><Wallet size={26} /><strong>No loans yet</strong><p>Loan accounts will appear here once applied for and disbursed.</p></div> : <div className="table-scroll"><table><thead><tr><th>Account</th><th>Product</th><th>Principal</th><th>Total Paid</th><th>Outstanding</th><th>Interest Outstanding</th><th>Status</th><th>Disbursed</th><th></th></tr></thead><tbody>{loanRows.map(({ loan, totalPaidMinor, interestOutstandingMinor, outstandingMinor }) => <tr key={loan.id}><td className="mono">{loan.accountNumber}</td><td>{loan.product.name}</td><td>{formatMinor(loan.principalMinor, loan.denominationCurrency)}</td><td>{formatMinor(totalPaidMinor, loan.denominationCurrency)}</td><td>{formatMinor(outstandingMinor, loan.denominationCurrency)}</td><td>{formatMinor(interestOutstandingMinor, loan.denominationCurrency)}</td><td><span className={`status ${loan.status === "ACTIVE" ? "up-to-date" : loan.status === "IN_ARREARS" ? "in-arrears" : "review"}`}>{loan.status}</span></td><td>{loan.disbursedOn ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(loan.disbursedOn) : "\u2014"}</td><td><Link className="green-link" href={`/loans/${loan.id}`}>View</Link></td></tr>)}</tbody></table></div>}
        </section>
      ) : null}

      {activeTab === "savings" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Savings</h2><p>Savings, share and deposit accounts held by this client</p></div>{canTransact && client.status === "ACTIVE" && client.savingsAccounts.length === 0 ? <NewSavingsAccountWizard charges={savingsCharges.map((charge) => ({ id: charge.id, name: charge.name, calculationType: charge.calculationType, amountMinor: charge.amountMinor?.toString() ?? null, percentageBps: charge.percentageBps, currencyCode: charge.currencyCode }))} clientId={client.id} officers={officers} products={savingsProducts.map((product) => ({ id: product.id, name: product.name, shortName: product.shortName, currencyCode: product.currencyCode, nominalAnnualRateBps: product.nominalAnnualRateBps, minOpeningBalanceMinor: product.minOpeningBalanceMinor.toString() }))} /> : null}</div>
          {client.savingsAccounts.length === 0 ? <div className="empty-state compact-empty"><PiggyBank size={26} /><strong>No savings accounts yet</strong><p>Open one above to start recording deposits.</p></div> : <div className="table-scroll"><table><thead><tr><th>Account</th><th>Type</th><th>Product</th><th>Currency</th><th>Balance</th><th>Status</th><th>Opened</th><th></th></tr></thead><tbody>{savingsRows.map(({ account, balanceMinor }) => <tr key={account.id}><td className="mono"><Link className="green-link" href={`/savings-accounts/${account.accountNumber}`}>{account.accountNumber}</Link></td><td>{account.accountType.replaceAll("_", " ")}</td><td>{account.product?.name ?? "\u2014"}</td><td>{account.currencyCode}</td><td>{formatMinor(balanceMinor, account.currencyCode)}</td><td><span className={`status ${account.status === "ACTIVE" ? "up-to-date" : "review"}`}>{account.status === "SUBMITTED" ? "Pending approval" : account.status}</span></td><td>{new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(account.createdAt)}</td><td>{account.status === "SUBMITTED" && canApproveSavings && account.submittedById !== session.user.id ? <ApproveSavingsAccountButton clientId={client.id} savingsAccountId={account.id} /> : null}</td></tr>)}</tbody></table></div>}
          {client.status === "ACTIVE" && ((canTransact && savingsTargets.length > 0) || loanPaymentTargets.length > 0) ? <DepositWithdrawForm clientId={client.id} currentUserName={session.user.name ?? "Signed in user"} loanTargets={loanPaymentTargets} savingsTargets={canTransact ? savingsTargets : []} settlementAccounts={settlementAccounts} /> : null}
        </section>
      ) : null}

      {activeTab === "charges" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Charges</h2><p>Fees and penalties applied to this client</p></div></div>
          <ChargesList canManage={canManage} charges={client.charges.map((charge) => ({ id: charge.id, name: charge.name, amountFormatted: formatMinor(charge.amountMinor, charge.currencyCode), status: charge.status, dueOnFormatted: charge.dueOn ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(charge.dueOn) : null }))} clientId={client.id} />
          {canManage ? <AddChargeForm clientId={client.id} /> : null}
        </section>
      ) : null}


      {activeTab === "family" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Family members</h2><p>Next of kin and dependents on record</p></div></div>
          {client.familyMembers.length === 0 ? <div className="empty-state compact-empty"><Users size={26} /><strong>No family members yet</strong><p>Add the client&apos;s next of kin or dependents below.</p></div> : <div className="table-scroll"><table><thead><tr><th>Name</th><th>Relationship</th><th>Gender</th><th>Mobile</th><th>Age</th><th>Dependent</th><th>Attached files</th></tr></thead><tbody>{client.familyMembers.map((member) => { const memberName = [member.firstName, member.middleName, member.lastName].filter(Boolean).join(" "); return <tr key={member.id}><td><div className="person-cell"><EntityAvatar genderCode={member.genderCode} name={memberName} seed={member.id} size={28} /><span className="person-copy"><strong>{memberName}</strong></span></div></td><td>{member.relationship ?? "\u2014"}</td><td>{member.genderCode ?? "\u2014"}</td><td>{member.mobileNumber ?? "\u2014"}</td><td>{member.age ?? "\u2014"}</td><td>{member.isDependent ? "Yes" : "No"}</td><td>{member.documents.length === 0 ? <span className="muted-text">None</span> : <div className="identity-files">{member.documents.map((document) => document.mediaType.startsWith("image/") ? <a href={`/api/documents/${document.id}`} key={document.id} rel="noreferrer" target="_blank"><img alt={document.name} className="identity-thumb" src={`/api/documents/${document.id}`} /></a> : <a className="green-link" href={`/api/documents/${document.id}`} key={document.id}>{document.name}</a>)}</div>}</td></tr>; })}</tbody></table></div>}
          <AddFamilyMemberForm clientId={client.id} />
          {client.familyMembers.length > 0 ? <UploadDocumentForm clientId={client.id} familyMembers={client.familyMembers.map((member) => ({ id: member.id, name: [member.firstName, member.middleName, member.lastName].filter(Boolean).join(" ") }))} title="Attach document to a family member" /> : null}
        </section>
      ) : null}

      {activeTab === "identities" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Identities</h2><p>Government or institutional identifiers on file</p></div></div>
          {client.identifiers.length === 0 ? <div className="empty-state compact-empty"><IdCard size={26} /><strong>No identities recorded</strong><p>Add a passport, national ID, or other document below.</p></div> : <div className="table-scroll"><table><thead><tr><th>Document type</th><th>Unique #</th><th>Status</th><th>Description</th><th>Attached files</th></tr></thead><tbody>{client.identifiers.map((identifier) => <tr key={identifier.id}><td>{identifier.documentType}</td><td className="mono">{identifier.uniqueNumber}</td><td><span className={`status ${identifier.status === "ACTIVE" ? "up-to-date" : "review"}`}>{identifier.status}</span></td><td>{identifier.description ?? "\u2014"}</td><td>{identifier.documents.length === 0 ? <span className="muted-text">None</span> : <div className="identity-files">{identifier.documents.map((document) => document.mediaType.startsWith("image/") ? <a href={`/api/documents/${document.id}`} key={document.id} rel="noreferrer" target="_blank"><img alt={document.name} className="identity-thumb" src={`/api/documents/${document.id}`} /></a> : <a className="green-link" href={`/api/documents/${document.id}`} key={document.id}>{document.name}</a>)}</div>}</td></tr>)}</tbody></table></div>}
          <AddIdentifierForm clientId={client.id} />
          {client.identifiers.length > 0 ? <UploadDocumentForm clientId={client.id} identifiers={client.identifiers.map((identifier) => ({ id: identifier.id, documentType: identifier.documentType, uniqueNumber: identifier.uniqueNumber }))} title="Attach document to an identity" /> : null}
        </section>
      ) : null}

      {activeTab === "documents" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Documents</h2><p>Uploaded files attached to this client</p></div></div>
          {client.documents.length === 0 ? <div className="empty-state compact-empty"><FileText size={26} /><strong>No documents uploaded</strong><p>Upload identity scans or supporting paperwork below.</p></div> : <div className="table-scroll"><table><thead><tr><th>Name</th><th>Description</th><th>Type</th><th>Uploaded</th><th></th></tr></thead><tbody>{client.documents.map((document) => <tr key={document.id}><td><strong>{document.name}</strong></td><td>{document.description ?? "\u2014"}</td><td>{document.mediaType}</td><td>{new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(document.createdAt)}</td><td><a className="green-link" href={`/api/documents/${document.id}`}>Download</a></td></tr>)}</tbody></table></div>}
          <UploadDocumentForm clientId={client.id} />
        </section>
      ) : null}

      {activeTab === "notes" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Notes</h2><p>Internal notes visible to your office</p></div></div>
          {client.notes.length === 0 ? <div className="empty-state compact-empty"><StickyNote size={26} /><strong>No notes yet</strong><p>Leave context for other staff working with this client.</p></div> : <ul className="note-list">{client.notes.map((note) => <li key={note.id}><p>{note.body}</p><small>{note.author.name} \u00b7 {new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(note.createdAt)}</small></li>)}</ul>}
          <AddNoteForm clientId={client.id} />
        </section>
      ) : null}
        </div>

        <aside className="client-side">
          <div className="panel-heading"><h2>Actions</h2></div>
          <ClientActionsMenu accountNumber={client.accountNumber} canManage={canManage} canTransact={canTransact} clientId={client.id} hasOfficer={Boolean(client.assignedOfficerId)} hasSignature={Boolean(client.signatureDocumentId)} officers={officers} status={client.status} />
        </aside>
      </div>
    </main>
  );
}

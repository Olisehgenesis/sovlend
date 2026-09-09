import type { Client, ClientStatus, LoanStatus, PrismaClient } from "@prisma/client";

import { clientScopeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { getClientWalletSummary } from "@/modules/lending/application/client-wallet";
import { installmentDueMinor, installmentPaidMinor } from "@/modules/lending/domain/loan-outstanding";

export type ClientStatementSearchRow = Readonly<{
  id: string;
  accountNumber: string;
  fullName: string;
  mobileNumber: string | null;
  externalId: string | null;
  officeName: string;
  status: ClientStatus;
}>;

/**
 * Free-text lookup used by the "search for a client" step of the Client Statement report —
 * matches on account number, name parts, external id, or mobile number. Always scoped like
 * every other client-facing surface (an officer with `scope.officerUserId` only ever finds
 * clients assigned to them).
 */
export async function searchClientsForStatement(
  prisma: PrismaClient,
  scope: UserDataScope,
  query: string,
): Promise<ClientStatementSearchRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const clients = await prisma.client.findMany({
    where: {
      organizationId: scope.organizationId,
      ...clientScopeWhere(scope),
      OR: [
        { accountNumber: { contains: trimmed, mode: "insensitive" } },
        { firstName: { contains: trimmed, mode: "insensitive" } },
        { middleName: { contains: trimmed, mode: "insensitive" } },
        { lastName: { contains: trimmed, mode: "insensitive" } },
        { externalId: { contains: trimmed, mode: "insensitive" } },
        { mobileNumber: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    include: { office: { select: { name: true } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 25,
  });

  return clients.map((client) => ({
    id: client.id,
    accountNumber: client.accountNumber,
    fullName: fullNameOf(client),
    mobileNumber: client.mobileNumber,
    externalId: client.externalId,
    officeName: client.office.name,
    status: client.status,
  }));
}

export type ClientStatementLoanRow = Readonly<{
  id: string;
  accountNumber: string;
  productName: string;
  status: LoanStatus;
  currencyCode: string;
  principalMinor: bigint;
  disbursedOn: Date | null;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  feesPaidMinor: bigint;
  monitoringFeePaidMinor: bigint;
  penaltiesPaidMinor: bigint;
  totalPaidMinor: bigint;
  outstandingMinor: bigint;
}>;

export type ClientStatementSavingsRow = Readonly<{
  id: string;
  accountNumber: string;
  productName: string;
  status: string;
  currencyCode: string;
  balanceMinor: bigint;
}>;

export type ClientStatementChargeRow = Readonly<{
  id: string;
  name: string;
  status: string;
  currencyCode: string;
  amountMinor: bigint;
  dueOn: Date | null;
  loanAccountNumber: string | null;
}>;

export type ClientStatement = Readonly<{
  asOf: Date;
  client: Readonly<{
    id: string;
    fullName: string;
    accountNumber: string;
    externalId: string | null;
    mobileNumber: string | null;
    status: ClientStatus;
    officeName: string;
    assignedOfficerName: string | null;
    joinedOn: Date | null;
  }>;
  loans: readonly ClientStatementLoanRow[];
  savingsAccounts: readonly ClientStatementSavingsRow[];
  charges: readonly ClientStatementChargeRow[];
  totals: Readonly<{
    currencyCode: string;
    totalPrincipalDisbursedMinor: bigint;
    totalPrincipalPaidMinor: bigint;
    totalInterestPaidMinor: bigint;
    totalPaidMinor: bigint;
    totalLoanOutstandingMinor: bigint;
    totalSavingsBalanceMinor: bigint;
    totalChargesOutstandingMinor: bigint;
    netWorthMinor: bigint;
  }>;
}>;

/**
 * Builds the full printable "Client Statement" report: every loan (with amount disbursed,
 * paid, and outstanding), every savings account balance, every charge, and portfolio-wide
 * totals -- everything a branch needs to hand a client (or an auditor) a single-page
 * financial position summary. Reuses the exact same per-loan/per-savings-account computations
 * as the client detail page and `getClientWalletSummary`, so figures always agree.
 */
export async function loadClientStatement(
  prisma: PrismaClient,
  scope: UserDataScope,
  accountNumber: string,
  asOf: Date = new Date(),
): Promise<ClientStatement | null> {
  const client = await prisma.client.findFirst({
    where: { accountNumber, organizationId: scope.organizationId, ...clientScopeWhere(scope) },
    include: {
      office: { select: { name: true } },
      assignedOfficer: { select: { name: true } },
      loans: {
        orderBy: { createdAt: "desc" },
        include: {
          product: { select: { name: true } },
          installments: {
            select: {
              principalDueMinor: true,
              principalPaidMinor: true,
              interestDueMinor: true,
              interestPaidMinor: true,
              feesDueMinor: true,
              feesPaidMinor: true,
              monitoringFeeDueMinor: true,
              monitoringFeePaidMinor: true,
              penaltiesDueMinor: true,
              penaltiesPaidMinor: true,
            },
          },
        },
      },
      savingsAccounts: {
        orderBy: { createdAt: "desc" },
        include: { product: { select: { name: true } }, transactions: { select: { amountMinor: true } } },
      },
      charges: { orderBy: { createdAt: "desc" }, include: { loan: { select: { accountNumber: true } } } },
    },
  });
  if (!client) return null;

  const wallet = await getClientWalletSummary(prisma, client.id);

  const loans: ClientStatementLoanRow[] = client.loans.map((loan) => {
    const principalPaidMinor = loan.installments.reduce((sum, installment) => sum + installment.principalPaidMinor, 0n);
    const interestPaidMinor = loan.installments.reduce((sum, installment) => sum + installment.interestPaidMinor, 0n);
    const feesPaidMinor = loan.installments.reduce((sum, installment) => sum + installment.feesPaidMinor, 0n);
    const monitoringFeePaidMinor = loan.installments.reduce((sum, installment) => sum + (installment.monitoringFeePaidMinor ?? 0n), 0n);
    const penaltiesPaidMinor = loan.installments.reduce((sum, installment) => sum + installment.penaltiesPaidMinor, 0n);
    const outstandingMinor = loan.installments.reduce(
      (sum, installment) => sum + installmentDueMinor(installment) - installmentPaidMinor(installment),
      0n,
    );
    return {
      id: loan.id,
      accountNumber: loan.accountNumber,
      productName: loan.product.name,
      status: loan.status,
      currencyCode: loan.denominationCurrency,
      principalMinor: loan.principalMinor,
      disbursedOn: loan.disbursedOn,
      principalPaidMinor,
      interestPaidMinor,
      feesPaidMinor,
      monitoringFeePaidMinor,
      penaltiesPaidMinor,
      totalPaidMinor:
        principalPaidMinor +
        interestPaidMinor +
        feesPaidMinor +
        monitoringFeePaidMinor +
        penaltiesPaidMinor,
      outstandingMinor,
    };
  });

  const savingsAccounts: ClientStatementSavingsRow[] = client.savingsAccounts.map((account) => ({
    id: account.id,
    accountNumber: account.accountNumber,
    productName: account.product?.name ?? "—",
    status: account.status,
    currencyCode: account.currencyCode,
    balanceMinor: account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n),
  }));

  const charges: ClientStatementChargeRow[] = client.charges.map((charge) => ({
    id: charge.id,
    name: charge.name,
    status: charge.status,
    currencyCode: charge.currencyCode,
    amountMinor: charge.amountMinor,
    dueOn: charge.dueOn,
    loanAccountNumber: charge.loan?.accountNumber ?? null,
  }));

  const currencyCode = wallet.currencyCode;
  const totalPrincipalDisbursedMinor = loans.reduce((sum, loan) => sum + (loan.disbursedOn ? loan.principalMinor : 0n), 0n);
  const totalPrincipalPaidMinor = loans.reduce((sum, loan) => sum + loan.principalPaidMinor, 0n);
  const totalInterestPaidMinor = loans.reduce((sum, loan) => sum + loan.interestPaidMinor, 0n);
  const totalPaidMinor = loans.reduce((sum, loan) => sum + loan.totalPaidMinor, 0n);
  const totalChargesOutstandingMinor = charges.reduce((sum, charge) => sum + (charge.status === "PENDING" ? charge.amountMinor : 0n), 0n);

  return {
    asOf,
    client: {
      id: client.id,
      fullName: fullNameOf(client),
      accountNumber: client.accountNumber,
      externalId: client.externalId,
      mobileNumber: client.mobileNumber,
      status: client.status,
      officeName: client.office.name,
      assignedOfficerName: client.assignedOfficer?.name ?? null,
      joinedOn: client.activatedOn ?? client.submittedOn,
    },
    loans,
    savingsAccounts,
    charges,
    totals: {
      currencyCode,
      totalPrincipalDisbursedMinor,
      totalPrincipalPaidMinor,
      totalInterestPaidMinor,
      totalPaidMinor,
      totalLoanOutstandingMinor: wallet.loanOutstandingMinor,
      totalSavingsBalanceMinor: wallet.savingsBalanceMinor,
      totalChargesOutstandingMinor,
      netWorthMinor: wallet.netBalanceMinor,
    },
  };
}

function fullNameOf(client: Pick<Client, "firstName" | "middleName" | "lastName">) {
  return [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");
}

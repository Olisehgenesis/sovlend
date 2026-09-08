import type { PrismaClient } from "@prisma/client";

import { clientScopeWhere, groupScopeWhere, officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { rowsToCsv } from "@/modules/lending/domain/loan-export";

/**
 * iLend has no canned Savings reports at all — this whole module is SovLend-original,
 * built to close that gap rather than translate an existing report. Column naming still
 * follows the Title Case / "Office/Branch" / "Account No." conventions established for
 * the loan reports, so the Savings section reads consistently with the rest of the app.
 */

function normalizeString(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function formatHumanName(firstName: string, middleName: string | null, lastName: string) {
  return [firstName, middleName, lastName].filter(Boolean).join(" ");
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function accountTypeLabel(accountType: string) {
  return accountType.replaceAll("_", " ");
}

export function savingsStatusTone(status: string) {
  switch (status) {
    case "ACTIVE":
      return "up-to-date";
    case "SUBMITTED":
      return "review";
    case "CLOSED":
      return "closed";
    default:
      return "review";
  }
}

export type SavingsAccountRow = {
  id: string;
  accountNumber: string;
  ownerKind: "CLIENT" | "GROUP" | "UNLINKED";
  ownerName: string;
  ownerAccountNumber: string | null;
  officeId: string | null;
  officeName: string;
  productName: string;
  accountType: string;
  status: string;
  currencyCode: string;
  balanceMinor: bigint;
  fieldOfficerId: string | null;
  fieldOfficerName: string;
  openedOn: Date | null;
};

export type SavingsAccountListingReport = {
  officeId: string | null;
  rows: SavingsAccountRow[];
};

/** Per-account register — the savings equivalent of the Client Listing / Active Loans reports. */
export async function loadSavingsAccountListingReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: { officeId?: string | null },
): Promise<SavingsAccountListingReport> {
  const officeId = normalizeString(params.officeId);

  const accounts = await prisma.savingsAccount.findMany({
    where: {
      OR: [
        { client: { is: { organizationId: scope.organizationId, ...clientScopeWhere(scope), ...(officeId ? { officeId } : {}) } } },
        { group: { is: { organizationId: scope.organizationId, ...groupScopeWhere(scope), ...(officeId ? { officeId } : {}) } } },
      ],
    },
    select: {
      id: true,
      accountNumber: true,
      accountType: true,
      status: true,
      currencyCode: true,
      submittedOn: true,
      approvedOn: true,
      createdAt: true,
      client: {
        select: {
          accountNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          officeId: true,
          office: { select: { name: true } },
        },
      },
      group: {
        select: {
          accountNumber: true,
          name: true,
          officeId: true,
          office: { select: { name: true } },
        },
      },
      product: { select: { name: true } },
      fieldOfficer: { select: { id: true, name: true } },
      transactions: { select: { amountMinor: true } },
    },
    orderBy: [{ createdAt: "desc" }, { accountNumber: "asc" }],
  });

  const rows = accounts.map<SavingsAccountRow>((account) => {
    const owner = account.client
      ? {
          kind: "CLIENT" as const,
          name: formatHumanName(account.client.firstName, account.client.middleName, account.client.lastName),
          accountNumber: account.client.accountNumber,
          officeId: account.client.officeId,
          officeName: account.client.office.name,
        }
      : account.group
        ? {
            kind: "GROUP" as const,
            name: account.group.name,
            accountNumber: account.group.accountNumber,
            officeId: account.group.officeId,
            officeName: account.group.office.name,
          }
        : null;

    return {
      id: account.id,
      accountNumber: account.accountNumber,
      ownerKind: owner?.kind ?? "UNLINKED",
      ownerName: owner?.name ?? "Unknown owner",
      ownerAccountNumber: owner?.accountNumber ?? null,
      officeId: owner?.officeId ?? null,
      officeName: owner?.officeName ?? "—",
      productName: account.product?.name ?? "Unlinked product",
      accountType: account.accountType,
      status: account.status,
      currencyCode: account.currencyCode,
      balanceMinor: account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n),
      fieldOfficerId: account.fieldOfficer?.id ?? null,
      fieldOfficerName: account.fieldOfficer?.name ?? "Unassigned",
      openedOn: account.approvedOn ?? account.submittedOn ?? account.createdAt,
    };
  });

  return { officeId, rows };
}

export function savingsAccountListingReportCsv(report: SavingsAccountListingReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      "Office/Branch": row.officeName,
      Client: row.ownerName,
      "Client Account No.": row.ownerAccountNumber ?? "",
      "Savings Account No.": row.accountNumber,
      Product: row.productName,
      "Account Type": accountTypeLabel(row.accountType),
      Status: row.status,
      Currency: row.currencyCode,
      Balance: row.balanceMinor.toString(),
      "Savings Officer": row.fieldOfficerName,
      "Opened Date": row.openedOn ? isoDate(row.openedOn) : "",
    })),
    [
      "Office/Branch",
      "Client",
      "Client Account No.",
      "Savings Account No.",
      "Product",
      "Account Type",
      "Status",
      "Currency",
      "Balance",
      "Savings Officer",
      "Opened Date",
    ],
  );
}

export type SavingsTransactionRow = {
  id: string;
  businessDate: Date;
  accountNumber: string;
  ownerName: string;
  officeName: string;
  productName: string;
  transactionType: string;
  amountMinor: bigint;
  currencyCode: string;
  externalReference: string | null;
};

export type SavingsTransactionsReport = {
  officeId: string | null;
  startDate: Date;
  endDate: Date;
  rows: SavingsTransactionRow[];
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function parseDateInput(value: string | null | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/** Deposits/withdrawals/charges ledger — the savings equivalent of the loan Collections report. */
export async function loadSavingsTransactionsReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: { officeId?: string | null; startDate?: string | null; endDate?: string | null },
): Promise<SavingsTransactionsReport> {
  const officeId = normalizeString(params.officeId);
  const now = new Date();
  const startDate = startOfUtcDay(parseDateInput(params.startDate, new Date(now.getFullYear(), now.getMonth(), 1)));
  const endDate = endOfUtcDay(parseDateInput(params.endDate, now));

  const transactions = await prisma.savingsTransaction.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      savingsAccount: {
        OR: [
          { client: { is: { organizationId: scope.organizationId, ...officeWhere(scope), ...(officeId ? { officeId } : {}) } } },
          { group: { is: { organizationId: scope.organizationId, ...officeWhere(scope), ...(officeId ? { officeId } : {}) } } },
        ],
      },
    },
    select: {
      id: true,
      transactionType: true,
      amountMinor: true,
      externalReference: true,
      createdAt: true,
      savingsAccount: {
        select: {
          accountNumber: true,
          currencyCode: true,
          client: {
            select: {
              firstName: true,
              middleName: true,
              lastName: true,
              office: { select: { name: true } },
            },
          },
          group: { select: { name: true, office: { select: { name: true } } } },
          product: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = transactions.map<SavingsTransactionRow>((transaction) => {
    const account = transaction.savingsAccount;
    const ownerName = account.client
      ? formatHumanName(account.client.firstName, account.client.middleName, account.client.lastName)
      : account.group?.name ?? "Unknown owner";
    const officeName = account.client?.office.name ?? account.group?.office.name ?? "—";

    return {
      id: transaction.id,
      businessDate: transaction.createdAt,
      accountNumber: account.accountNumber,
      ownerName,
      officeName,
      productName: account.product?.name ?? "Unlinked product",
      transactionType: transaction.transactionType,
      amountMinor: transaction.amountMinor,
      currencyCode: account.currencyCode,
      externalReference: transaction.externalReference,
    };
  });

  return { officeId, startDate, endDate, rows };
}

export function savingsTransactionsReportCsv(report: SavingsTransactionsReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      Date: isoDate(row.businessDate),
      Client: row.ownerName,
      "Savings Account No.": row.accountNumber,
      "Office/Branch": row.officeName,
      Product: row.productName,
      "Transaction Type": row.transactionType,
      Amount: row.amountMinor.toString(),
      Currency: row.currencyCode,
      Reference: row.externalReference ?? "",
    })),
    [
      "Date",
      "Client",
      "Savings Account No.",
      "Office/Branch",
      "Product",
      "Transaction Type",
      "Amount",
      "Currency",
      "Reference",
    ],
  );
}

export type SavingsOfficerPortfolioRow = {
  officerId: string | null;
  officerName: string;
  currencyCode: string;
  accountCount: number;
  activeAccountCount: number;
  totalBalanceMinor: bigint;
  averageBalanceMinor: bigint;
};

export type SavingsPortfolioByOfficerReport = {
  rows: SavingsOfficerPortfolioRow[];
};

/** Savings balances aggregated per field officer — the savings equivalent of Branch Portfolio. */
export async function loadSavingsPortfolioByOfficerReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: { officeId?: string | null },
): Promise<SavingsPortfolioByOfficerReport> {
  const officeId = normalizeString(params.officeId);

  const accounts = await prisma.savingsAccount.findMany({
    where: {
      OR: [
        { client: { is: { organizationId: scope.organizationId, ...officeWhere(scope), ...(officeId ? { officeId } : {}) } } },
        { group: { is: { organizationId: scope.organizationId, ...officeWhere(scope), ...(officeId ? { officeId } : {}) } } },
      ],
    },
    select: {
      status: true,
      currencyCode: true,
      fieldOfficer: { select: { id: true, name: true } },
      transactions: { select: { amountMinor: true } },
    },
  });

  const totalsMap = new Map<string, SavingsOfficerPortfolioRow>();
  for (const account of accounts) {
    const officerId = account.fieldOfficer?.id ?? null;
    const officerName = account.fieldOfficer?.name ?? "Unassigned";
    const key = `${officerId ?? "unassigned"}::${account.currencyCode}`;
    const balanceMinor = account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);

    const row =
      totalsMap.get(key) ??
      {
        officerId,
        officerName,
        currencyCode: account.currencyCode,
        accountCount: 0,
        activeAccountCount: 0,
        totalBalanceMinor: 0n,
        averageBalanceMinor: 0n,
      };
    row.accountCount += 1;
    if (account.status === "ACTIVE") row.activeAccountCount += 1;
    row.totalBalanceMinor += balanceMinor;
    totalsMap.set(key, row);
  }

  const rows = [...totalsMap.values()]
    .map((row) => ({
      ...row,
      averageBalanceMinor: row.accountCount > 0 ? row.totalBalanceMinor / BigInt(row.accountCount) : 0n,
    }))
    .sort(
      (left, right) =>
        left.officerName.localeCompare(right.officerName) || left.currencyCode.localeCompare(right.currencyCode),
    );

  return { rows };
}

export function savingsPortfolioByOfficerReportCsv(report: SavingsPortfolioByOfficerReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      "Savings Officer": row.officerName,
      Currency: row.currencyCode,
      "Number of Accounts": String(row.accountCount),
      "Active Accounts": String(row.activeAccountCount),
      "Total Balance": row.totalBalanceMinor.toString(),
      "Average Balance": row.averageBalanceMinor.toString(),
    })),
    [
      "Savings Officer",
      "Currency",
      "Number of Accounts",
      "Active Accounts",
      "Total Balance",
      "Average Balance",
    ],
  );
}

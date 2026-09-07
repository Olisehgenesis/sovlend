import type { AccountType, EntryDirection, Prisma, PrismaClient } from "@prisma/client";

import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { rowsToCsv } from "@/modules/lending/domain/loan-export";

export const reportDateFormatter = new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" });

const DETAIL_ACCOUNT_WHERE = {
  active: true,
  usage: "DETAIL",
  currencyCode: "UGX",
} as const;

type ReportPrisma = PrismaClient | Prisma.TransactionClient;
export type BalanceSide = "DEBIT" | "CREDIT" | "ZERO";
export type ReportOffice = { id: string; name: string };
export type ReportAccount = { id: string; code: string; name: string; type: AccountType; currencyCode: string };

type ReportSectionRow = ReportAccount & {
  balanceMinor: bigint;
  balanceSide: BalanceSide;
};

type ReportSection = {
  label: string;
  type: AccountType;
  rows: ReportSectionRow[];
  totalMinor: bigint;
};

type LineWithAccount = {
  journalId: string;
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
  account: { type: AccountType };
};

export type BalanceSheetReport = {
  asOfDate: Date;
  officeId: string | null;
  journalCount: number;
  lineCount: number;
  hasActivity: boolean;
  sections: ReportSection[];
  assetsTotalMinor: bigint;
  liabilitiesTotalMinor: bigint;
  equityTotalMinor: bigint;
  liabilitiesAndEquityTotalMinor: bigint;
  differenceMinor: bigint;
};

export type IncomeStatementReport = {
  startDate: Date;
  endDate: Date;
  officeId: string | null;
  journalCount: number;
  lineCount: number;
  hasActivity: boolean;
  revenue: ReportSection;
  expenses: ReportSection;
  netIncomeMinor: bigint;
};

export type TrialBalanceRow = ReportAccount & {
  debitTotalMinor: bigint;
  creditTotalMinor: bigint;
  balanceMinor: bigint;
  balanceSide: BalanceSide;
};

export type TrialBalanceReport = {
  startDate: Date;
  endDate: Date;
  officeId: string | null;
  journalCount: number;
  lineCount: number;
  hasActivity: boolean;
  rows: TrialBalanceRow[];
  totalDebitsMinor: bigint;
  totalCreditsMinor: bigint;
  differenceMinor: bigint;
};

export type GeneralLedgerEntry = {
  id: string;
  journalId: string;
  businessDate: Date;
  officeName: string;
  referenceType: string;
  referenceId: string | null;
  narration: string;
  direction: EntryDirection;
  amountMinor: bigint;
  memo: string | null;
  runningBalanceMinor: bigint;
  runningBalanceSide: BalanceSide;
};

export type GeneralLedgerReport = {
  startDate: Date;
  endDate: Date;
  officeId: string | null;
  account: ReportAccount | null;
  journalCount: number;
  lineCount: number;
  hasActivity: boolean;
  entries: GeneralLedgerEntry[];
  debitTotalMinor: bigint;
  creditTotalMinor: bigint;
  closingBalanceMinor: bigint;
  closingBalanceSide: BalanceSide;
};

export type JournalReconciliationLine = ReportAccount & {
  lineId: string;
  direction: EntryDirection;
  amountMinor: bigint;
  memo: string | null;
};

export type JournalReconciliationJournal = {
  id: string;
  businessDate: Date;
  officeId: string;
  officeName: string;
  referenceType: string;
  referenceId: string | null;
  narration: string;
  status: string;
  debitTotalMinor: bigint;
  creditTotalMinor: bigint;
  differenceMinor: bigint;
  isBalanced: boolean;
  lines: JournalReconciliationLine[];
};

export type JournalReconciliationReport = {
  startDate: Date;
  endDate: Date;
  officeId: string | null;
  accountId: string | null;
  journalCount: number;
  issueCount: number;
  hasActivity: boolean;
  totalDebitsMinor: bigint;
  totalCreditsMinor: bigint;
  differenceMinor: bigint;
  journals: JournalReconciliationJournal[];
};

export async function listAccountingReportOffices(db: ReportPrisma, scope: UserDataScope): Promise<ReportOffice[]> {
  return db.office.findMany({
    where: { organizationId: scope.organizationId, ...officeWhere(scope) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listAccountingReportAccounts(
  db: ReportPrisma,
  types?: readonly AccountType[],
): Promise<ReportAccount[]> {
  return db.ledgerAccount.findMany({
    where: {
      ...DETAIL_ACCOUNT_WHERE,
      ...(types ? { type: { in: [...types] } } : {}),
    },
    select: { id: true, code: true, name: true, type: true, currencyCode: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
}

export function formatDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatReportDate(date: Date) {
  return reportDateFormatter.format(date);
}

export function currentMonthDateRange(now = new Date()) {
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { startDate, endDate };
}

export function todayDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function parseDateInput(value: string | null | undefined, fallback: Date) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function normalizeDateRange(startDate: Date, endDate: Date) {
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

export function buildReportQueryString(values: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function resolveOfficeFilter(offices: readonly ReportOffice[], requestedOfficeId: string | null) {
  if (!requestedOfficeId) return null;
  return offices.some((office) => office.id === requestedOfficeId) ? requestedOfficeId : null;
}

export function resolveAccountFilter(accounts: readonly ReportAccount[], requestedAccountId: string | null) {
  if (!requestedAccountId) return null;
  return accounts.some((account) => account.id === requestedAccountId) ? requestedAccountId : null;
}

export function accountTypeLabel(type: AccountType) {
  switch (type) {
    case "ASSET":
      return "Asset";
    case "LIABILITY":
      return "Liability";
    case "EQUITY":
      return "Equity";
    case "REVENUE":
      return "Revenue";
    case "EXPENSE":
      return "Expense";
  }
}

export function journalStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function summarizeBalance(type: AccountType, balanceMinor: bigint) {
  const balanceSide = balanceSideForAccount(type, balanceMinor);
  const absoluteMinor = balanceMinor < 0n ? -balanceMinor : balanceMinor;
  return { absoluteMinor, balanceSide };
}

export function sideLabel(side: BalanceSide) {
  return side === "ZERO" ? "—" : side === "DEBIT" ? "Dr" : "Cr";
}

export function minorToString(value: bigint) {
  return value.toString();
}

export function dateToString(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function getBalanceSheetReport(
  db: ReportPrisma,
  scope: UserDataScope,
  filters: { endDate: Date; officeId: string | null },
): Promise<BalanceSheetReport> {
  const accounts = await listAccountingReportAccounts(db, ["ASSET", "LIABILITY", "EQUITY"]);
  const lines = await db.journalLine.findMany({
    where: {
      journal: {
        status: "POSTED",
        businessDate: { lte: filters.endDate },
        office: { organizationId: scope.organizationId },
        ...(filters.officeId ? { officeId: filters.officeId } : officeWhere(scope)),
      },
      account: { ...DETAIL_ACCOUNT_WHERE, type: { in: ["ASSET", "LIABILITY", "EQUITY"] } },
    },
    select: {
      journalId: true,
      accountId: true,
      direction: true,
      amountMinor: true,
      account: { select: { type: true } },
    },
  });

  const balances = new Map<string, bigint>();
  const journalIds = new Set<string>();
  for (const line of lines) {
    journalIds.add(line.journalId);
    balances.set(line.accountId, (balances.get(line.accountId) ?? 0n) + signedAmountForAccount(line.account.type, line.direction, line.amountMinor));
  }

  const sections = ([
    { label: "Assets", type: "ASSET" as const },
    { label: "Liabilities", type: "LIABILITY" as const },
    { label: "Equity", type: "EQUITY" as const },
  ]).map(({ label, type }) => buildSection(accounts, balances, type, label));

  const assetsTotalMinor = sections[0]?.totalMinor ?? 0n;
  const liabilitiesTotalMinor = sections[1]?.totalMinor ?? 0n;
  const equityTotalMinor = sections[2]?.totalMinor ?? 0n;
  const liabilitiesAndEquityTotalMinor = liabilitiesTotalMinor + equityTotalMinor;

  return {
    asOfDate: filters.endDate,
    officeId: filters.officeId,
    journalCount: journalIds.size,
    lineCount: lines.length,
    hasActivity: lines.length > 0,
    sections,
    assetsTotalMinor,
    liabilitiesTotalMinor,
    equityTotalMinor,
    liabilitiesAndEquityTotalMinor,
    differenceMinor: assetsTotalMinor - liabilitiesAndEquityTotalMinor,
  };
}

export async function getIncomeStatementReport(
  db: ReportPrisma,
  scope: UserDataScope,
  filters: { startDate: Date; endDate: Date; officeId: string | null },
): Promise<IncomeStatementReport> {
  const accounts = await listAccountingReportAccounts(db, ["REVENUE", "EXPENSE"]);
  const lines = await db.journalLine.findMany({
    where: {
      journal: {
        status: "POSTED",
        businessDate: { gte: filters.startDate, lte: filters.endDate },
        office: { organizationId: scope.organizationId },
        ...(filters.officeId ? { officeId: filters.officeId } : officeWhere(scope)),
      },
      account: { ...DETAIL_ACCOUNT_WHERE, type: { in: ["REVENUE", "EXPENSE"] } },
    },
    select: {
      journalId: true,
      accountId: true,
      direction: true,
      amountMinor: true,
      account: { select: { type: true } },
    },
  });

  const balances = new Map<string, bigint>();
  const journalIds = new Set<string>();
  for (const line of lines) {
    journalIds.add(line.journalId);
    balances.set(line.accountId, (balances.get(line.accountId) ?? 0n) + signedAmountForAccount(line.account.type, line.direction, line.amountMinor));
  }

  const revenue = buildSection(accounts, balances, "REVENUE", "Revenue");
  const expenses = buildSection(accounts, balances, "EXPENSE", "Expenses");

  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    officeId: filters.officeId,
    journalCount: journalIds.size,
    lineCount: lines.length,
    hasActivity: lines.length > 0,
    revenue,
    expenses,
    netIncomeMinor: revenue.totalMinor - expenses.totalMinor,
  };
}

export async function getTrialBalanceReport(
  db: ReportPrisma,
  scope: UserDataScope,
  filters: { startDate: Date; endDate: Date; officeId: string | null },
): Promise<TrialBalanceReport> {
  const accounts = await listAccountingReportAccounts(db);
  const lines = await db.journalLine.findMany({
    where: {
      journal: {
        status: "POSTED",
        businessDate: { gte: filters.startDate, lte: filters.endDate },
        office: { organizationId: scope.organizationId },
        ...(filters.officeId ? { officeId: filters.officeId } : officeWhere(scope)),
      },
      account: DETAIL_ACCOUNT_WHERE,
    },
    select: {
      journalId: true,
      accountId: true,
      direction: true,
      amountMinor: true,
      account: { select: { type: true } },
    },
  });

  const totals = new Map<string, { debits: bigint; credits: bigint; balance: bigint }>();
  const journalIds = new Set<string>();
  let totalDebitsMinor = 0n;
  let totalCreditsMinor = 0n;

  for (const line of lines) {
    journalIds.add(line.journalId);
    const current = totals.get(line.accountId) ?? { debits: 0n, credits: 0n, balance: 0n };
    if (line.direction === "DEBIT") {
      current.debits += line.amountMinor;
      totalDebitsMinor += line.amountMinor;
    } else {
      current.credits += line.amountMinor;
      totalCreditsMinor += line.amountMinor;
    }
    current.balance += signedAmountForAccount(line.account.type, line.direction, line.amountMinor);
    totals.set(line.accountId, current);
  }

  const rows = lines.length === 0
    ? []
    : accounts.map((account) => {
        const current = totals.get(account.id) ?? { debits: 0n, credits: 0n, balance: 0n };
        return {
          ...account,
          debitTotalMinor: current.debits,
          creditTotalMinor: current.credits,
          balanceMinor: current.balance,
          balanceSide: balanceSideForAccount(account.type, current.balance),
        };
      });

  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    officeId: filters.officeId,
    journalCount: journalIds.size,
    lineCount: lines.length,
    hasActivity: lines.length > 0,
    rows,
    totalDebitsMinor,
    totalCreditsMinor,
    differenceMinor: totalDebitsMinor - totalCreditsMinor,
  };
}

export async function getGeneralLedgerReport(
  db: ReportPrisma,
  scope: UserDataScope,
  filters: { startDate: Date; endDate: Date; officeId: string | null; accountId: string | null },
): Promise<GeneralLedgerReport> {
  const accounts = await listAccountingReportAccounts(db);
  const selectedAccount = filters.accountId
    ? accounts.find((account) => account.id === filters.accountId) ?? null
    : (accounts[0] ?? null);

  if (!selectedAccount) {
    return {
      startDate: filters.startDate,
      endDate: filters.endDate,
      officeId: filters.officeId,
      account: null,
      journalCount: 0,
      lineCount: 0,
      hasActivity: false,
      entries: [],
      debitTotalMinor: 0n,
      creditTotalMinor: 0n,
      closingBalanceMinor: 0n,
      closingBalanceSide: "ZERO",
    };
  }

  const lines = await db.journalLine.findMany({
    where: {
      accountId: selectedAccount.id,
      journal: {
        status: "POSTED",
        businessDate: { gte: filters.startDate, lte: filters.endDate },
        office: { organizationId: scope.organizationId },
        ...(filters.officeId ? { officeId: filters.officeId } : officeWhere(scope)),
      },
    },
    select: {
      id: true,
      journalId: true,
      direction: true,
      amountMinor: true,
      memo: true,
      createdAt: true,
      journal: {
        select: {
          businessDate: true,
          createdAt: true,
          office: { select: { name: true } },
          referenceType: true,
          referenceId: true,
          narration: true,
        },
      },
    },
  });

  lines.sort((left, right) => {
    const businessDateCompare = left.journal.businessDate.getTime() - right.journal.businessDate.getTime();
    if (businessDateCompare !== 0) return businessDateCompare;
    const journalCreatedCompare = left.journal.createdAt.getTime() - right.journal.createdAt.getTime();
    if (journalCreatedCompare !== 0) return journalCreatedCompare;
    const lineCreatedCompare = left.createdAt.getTime() - right.createdAt.getTime();
    if (lineCreatedCompare !== 0) return lineCreatedCompare;
    return left.id.localeCompare(right.id);
  });

  let runningBalanceMinor = 0n;
  let debitTotalMinor = 0n;
  let creditTotalMinor = 0n;
  const journalIds = new Set<string>();

  const entries = lines.map((line) => {
    journalIds.add(line.journalId);
    if (line.direction === "DEBIT") debitTotalMinor += line.amountMinor;
    else creditTotalMinor += line.amountMinor;
    runningBalanceMinor += signedAmountForAccount(selectedAccount.type, line.direction, line.amountMinor);
    return {
      id: line.id,
      journalId: line.journalId,
      businessDate: line.journal.businessDate,
      officeName: line.journal.office.name,
      referenceType: line.journal.referenceType,
      referenceId: line.journal.referenceId,
      narration: line.journal.narration,
      direction: line.direction,
      amountMinor: line.amountMinor,
      memo: line.memo,
      runningBalanceMinor,
      runningBalanceSide: balanceSideForAccount(selectedAccount.type, runningBalanceMinor),
    };
  });

  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    officeId: filters.officeId,
    account: selectedAccount,
    journalCount: journalIds.size,
    lineCount: lines.length,
    hasActivity: lines.length > 0,
    entries,
    debitTotalMinor,
    creditTotalMinor,
    closingBalanceMinor: runningBalanceMinor,
    closingBalanceSide: balanceSideForAccount(selectedAccount.type, runningBalanceMinor),
  };
}

export async function getJournalReconciliationReport(
  db: ReportPrisma,
  scope: UserDataScope,
  filters: { startDate: Date; endDate: Date; officeId: string | null; accountId: string | null },
): Promise<JournalReconciliationReport> {
  const journals = await db.journal.findMany({
    where: {
      businessDate: { gte: filters.startDate, lte: filters.endDate },
      office: { organizationId: scope.organizationId },
      ...(filters.officeId ? { officeId: filters.officeId } : officeWhere(scope)),
      ...(filters.accountId ? { lines: { some: { accountId: filters.accountId } } } : {}),
    },
    select: {
      id: true,
      businessDate: true,
      officeId: true,
      office: { select: { name: true } },
      referenceType: true,
      referenceId: true,
      narration: true,
      status: true,
      createdAt: true,
      lines: {
        select: {
          id: true,
          direction: true,
          amountMinor: true,
          memo: true,
          account: { select: { id: true, code: true, name: true, type: true, currencyCode: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  journals.sort((left, right) => {
    const businessDateCompare = right.businessDate.getTime() - left.businessDate.getTime();
    if (businessDateCompare !== 0) return businessDateCompare;
    const createdCompare = right.createdAt.getTime() - left.createdAt.getTime();
    if (createdCompare !== 0) return createdCompare;
    return right.id.localeCompare(left.id);
  });

  let totalDebitsMinor = 0n;
  let totalCreditsMinor = 0n;
  let issueCount = 0;

  const serializedJournals = journals.map((journal) => {
    let debitTotalMinor = 0n;
    let creditTotalMinor = 0n;
    for (const line of journal.lines) {
      if (line.direction === "DEBIT") {
        debitTotalMinor += line.amountMinor;
        totalDebitsMinor += line.amountMinor;
      } else {
        creditTotalMinor += line.amountMinor;
        totalCreditsMinor += line.amountMinor;
      }
    }
    const differenceMinor = debitTotalMinor - creditTotalMinor;
    const isBalanced = differenceMinor === 0n;
    if (!isBalanced) issueCount += 1;
    return {
      id: journal.id,
      businessDate: journal.businessDate,
      officeId: journal.officeId,
      officeName: journal.office.name,
      referenceType: journal.referenceType,
      referenceId: journal.referenceId,
      narration: journal.narration,
      status: journal.status,
      debitTotalMinor,
      creditTotalMinor,
      differenceMinor,
      isBalanced,
      lines: journal.lines.map((line) => ({
        lineId: line.id,
        direction: line.direction,
        amountMinor: line.amountMinor,
        memo: line.memo,
        ...line.account,
      })),
    };
  });

  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    officeId: filters.officeId,
    accountId: filters.accountId,
    journalCount: serializedJournals.length,
    issueCount,
    hasActivity: serializedJournals.length > 0,
    totalDebitsMinor,
    totalCreditsMinor,
    differenceMinor: totalDebitsMinor - totalCreditsMinor,
    journals: serializedJournals,
  };
}

export function balanceSheetReportCsv(report: BalanceSheetReport) {
  return rowsToCsv(
    [
      ...report.sections.flatMap((section) => [
        { account: section.label, balanceMinor: "" },
        ...section.rows.map((row) => ({
          account: `${row.code} · ${row.name}`,
          balanceMinor: row.balanceMinor.toString(),
        })),
        { account: `Total ${section.label}`, balanceMinor: section.totalMinor.toString() },
      ]),
      { account: "Assets", balanceMinor: report.assetsTotalMinor.toString() },
      { account: "Liabilities + Equity", balanceMinor: report.liabilitiesAndEquityTotalMinor.toString() },
      { account: "Difference", balanceMinor: report.differenceMinor.toString() },
    ],
    ["account", "balanceMinor"],
  );
}

export function serializeBalanceSheetReport(report: BalanceSheetReport) {
  return {
    asOfDate: dateToString(report.asOfDate),
    officeId: report.officeId,
    journalCount: report.journalCount,
    lineCount: report.lineCount,
    hasActivity: report.hasActivity,
    assetsTotalMinor: minorToString(report.assetsTotalMinor),
    liabilitiesTotalMinor: minorToString(report.liabilitiesTotalMinor),
    equityTotalMinor: minorToString(report.equityTotalMinor),
    liabilitiesAndEquityTotalMinor: minorToString(report.liabilitiesAndEquityTotalMinor),
    differenceMinor: minorToString(report.differenceMinor),
    sections: report.sections.map((section) => ({
      label: section.label,
      type: section.type,
      totalMinor: minorToString(section.totalMinor),
      rows: section.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        currencyCode: row.currencyCode,
        balanceMinor: minorToString(row.balanceMinor),
        balanceSide: row.balanceSide,
      })),
    })),
  };
}

export function incomeStatementReportCsv(report: IncomeStatementReport) {
  return rowsToCsv(
    [
      { account: report.revenue.label, amountMinor: "" },
      ...report.revenue.rows.map((row) => ({
        account: `${row.code} · ${row.name}`,
        amountMinor: row.balanceMinor.toString(),
      })),
      { account: `Total ${report.revenue.label}`, amountMinor: report.revenue.totalMinor.toString() },
      { account: report.expenses.label, amountMinor: "" },
      ...report.expenses.rows.map((row) => ({
        account: `${row.code} · ${row.name}`,
        amountMinor: row.balanceMinor.toString(),
      })),
      { account: `Total ${report.expenses.label}`, amountMinor: report.expenses.totalMinor.toString() },
      { account: "Net income", amountMinor: report.netIncomeMinor.toString() },
    ],
    ["account", "amountMinor"],
  );
}

export function serializeIncomeStatementReport(report: IncomeStatementReport) {
  return {
    startDate: dateToString(report.startDate),
    endDate: dateToString(report.endDate),
    officeId: report.officeId,
    journalCount: report.journalCount,
    lineCount: report.lineCount,
    hasActivity: report.hasActivity,
    revenue: serializeSection(report.revenue),
    expenses: serializeSection(report.expenses),
    netIncomeMinor: minorToString(report.netIncomeMinor),
  };
}

export function trialBalanceReportCsv(report: TrialBalanceReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      accountCode: row.code,
      accountName: row.name,
      accountType: row.type,
      debitTotalMinor: row.debitTotalMinor.toString(),
      creditTotalMinor: row.creditTotalMinor.toString(),
      balanceMinor: row.balanceMinor.toString(),
      balanceSide: row.balanceSide,
    })),
    ["accountCode", "accountName", "accountType", "debitTotalMinor", "creditTotalMinor", "balanceMinor", "balanceSide"],
  );
}

export function serializeTrialBalanceReport(report: TrialBalanceReport) {
  return {
    startDate: dateToString(report.startDate),
    endDate: dateToString(report.endDate),
    officeId: report.officeId,
    journalCount: report.journalCount,
    lineCount: report.lineCount,
    hasActivity: report.hasActivity,
    totalDebitsMinor: minorToString(report.totalDebitsMinor),
    totalCreditsMinor: minorToString(report.totalCreditsMinor),
    differenceMinor: minorToString(report.differenceMinor),
    rows: report.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      currencyCode: row.currencyCode,
      debitTotalMinor: minorToString(row.debitTotalMinor),
      creditTotalMinor: minorToString(row.creditTotalMinor),
      balanceMinor: minorToString(row.balanceMinor),
      balanceSide: row.balanceSide,
    })),
  };
}

export function generalLedgerReportCsv(report: GeneralLedgerReport) {
  return rowsToCsv(
    report.entries.map((entry) => ({
      businessDate: dateToString(entry.businessDate),
      referenceType: entry.referenceType,
      referenceId: entry.referenceId ?? "",
      journalId: entry.journalId,
      officeName: entry.officeName,
      memo: entry.memo ?? entry.narration,
      debitMinor: entry.direction === "DEBIT" ? entry.amountMinor.toString() : "",
      creditMinor: entry.direction === "CREDIT" ? entry.amountMinor.toString() : "",
      runningBalanceMinor: entry.runningBalanceMinor.toString(),
      runningBalanceSide: entry.runningBalanceSide,
    })),
    [
      "businessDate",
      "referenceType",
      "referenceId",
      "journalId",
      "officeName",
      "memo",
      "debitMinor",
      "creditMinor",
      "runningBalanceMinor",
      "runningBalanceSide",
    ],
  );
}

export function serializeGeneralLedgerReport(report: GeneralLedgerReport) {
  return {
    startDate: dateToString(report.startDate),
    endDate: dateToString(report.endDate),
    officeId: report.officeId,
    account: report.account
      ? {
          id: report.account.id,
          code: report.account.code,
          name: report.account.name,
          type: report.account.type,
          currencyCode: report.account.currencyCode,
        }
      : null,
    journalCount: report.journalCount,
    lineCount: report.lineCount,
    hasActivity: report.hasActivity,
    debitTotalMinor: minorToString(report.debitTotalMinor),
    creditTotalMinor: minorToString(report.creditTotalMinor),
    closingBalanceMinor: minorToString(report.closingBalanceMinor),
    closingBalanceSide: report.closingBalanceSide,
    entries: report.entries.map((entry) => ({
      id: entry.id,
      journalId: entry.journalId,
      businessDate: dateToString(entry.businessDate),
      officeName: entry.officeName,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      narration: entry.narration,
      direction: entry.direction,
      amountMinor: minorToString(entry.amountMinor),
      memo: entry.memo,
      runningBalanceMinor: minorToString(entry.runningBalanceMinor),
      runningBalanceSide: entry.runningBalanceSide,
    })),
  };
}

export function journalReconciliationReportCsv(report: JournalReconciliationReport) {
  return rowsToCsv(
    report.journals.flatMap((journal) =>
      journal.lines.map((line) => ({
        businessDate: dateToString(journal.businessDate),
        officeName: journal.officeName,
        referenceType: journal.referenceType,
        referenceId: journal.referenceId ?? "",
        journalId: journal.id,
        status: journal.status,
        accountCode: line.code,
        accountName: line.name,
        accountType: line.type,
        debitMinor: line.direction === "DEBIT" ? line.amountMinor.toString() : "",
        creditMinor: line.direction === "CREDIT" ? line.amountMinor.toString() : "",
        memo: line.memo ?? "",
      })),
    ),
    [
      "businessDate",
      "officeName",
      "referenceType",
      "referenceId",
      "journalId",
      "status",
      "accountCode",
      "accountName",
      "accountType",
      "debitMinor",
      "creditMinor",
      "memo",
    ],
  );
}

export function serializeJournalReconciliationReport(report: JournalReconciliationReport) {
  return {
    startDate: dateToString(report.startDate),
    endDate: dateToString(report.endDate),
    officeId: report.officeId,
    accountId: report.accountId,
    journalCount: report.journalCount,
    issueCount: report.issueCount,
    hasActivity: report.hasActivity,
    totalDebitsMinor: minorToString(report.totalDebitsMinor),
    totalCreditsMinor: minorToString(report.totalCreditsMinor),
    differenceMinor: minorToString(report.differenceMinor),
    journals: report.journals.map((journal) => ({
      id: journal.id,
      businessDate: dateToString(journal.businessDate),
      officeId: journal.officeId,
      officeName: journal.officeName,
      referenceType: journal.referenceType,
      referenceId: journal.referenceId,
      narration: journal.narration,
      status: journal.status,
      debitTotalMinor: minorToString(journal.debitTotalMinor),
      creditTotalMinor: minorToString(journal.creditTotalMinor),
      differenceMinor: minorToString(journal.differenceMinor),
      isBalanced: journal.isBalanced,
      lines: journal.lines.map((line) => ({
        lineId: line.lineId,
        accountId: line.id,
        code: line.code,
        name: line.name,
        type: line.type,
        currencyCode: line.currencyCode,
        direction: line.direction,
        amountMinor: minorToString(line.amountMinor),
        memo: line.memo,
      })),
    })),
  };
}

function buildSection(
  accounts: readonly ReportAccount[],
  balances: ReadonlyMap<string, bigint>,
  type: AccountType,
  label: string,
): ReportSection {
  const rows = accounts
    .filter((account) => account.type === type)
    .map((account) => {
      const balanceMinor = balances.get(account.id) ?? 0n;
      return {
        ...account,
        balanceMinor,
        balanceSide: balanceSideForAccount(account.type, balanceMinor),
      };
    })
    .filter((row) => row.balanceMinor !== 0n);

  return {
    label,
    type,
    rows,
    totalMinor: rows.reduce((sum, row) => sum + row.balanceMinor, 0n),
  };
}

function signedAmountForAccount(type: AccountType, direction: EntryDirection, amountMinor: bigint) {
  const debitIncreasesBalance = type === "ASSET" || type === "EXPENSE";
  if (direction === "DEBIT") return debitIncreasesBalance ? amountMinor : -amountMinor;
  return debitIncreasesBalance ? -amountMinor : amountMinor;
}

function balanceSideForAccount(type: AccountType, balanceMinor: bigint): BalanceSide {
  if (balanceMinor === 0n) return "ZERO";
  const positiveMeansDebit = type === "ASSET" || type === "EXPENSE";
  if (balanceMinor > 0n) return positiveMeansDebit ? "DEBIT" : "CREDIT";
  return positiveMeansDebit ? "CREDIT" : "DEBIT";
}

function serializeSection(section: ReportSection) {
  return {
    label: section.label,
    type: section.type,
    totalMinor: minorToString(section.totalMinor),
    rows: section.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      currencyCode: row.currencyCode,
      balanceMinor: minorToString(row.balanceMinor),
      balanceSide: row.balanceSide,
    })),
  };
}

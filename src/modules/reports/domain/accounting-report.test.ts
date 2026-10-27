import { describe, expect, it, vi } from "vitest";

import {
  generalLedgerReportCsv,
  getBalanceSheetReport,
  getGeneralLedgerReport,
  getGeneralLedgerJournal,
  getJournalReconciliationReport,
  getTrialBalanceReport,
  isManualJournalReferenceType,
  minorToAmountInputValue,
  parseAmountFilterMinor,
  resolveDatePreset,
  resolveEntrySourceFilter,
  serializeGeneralLedgerReport,
} from "@/modules/reports/domain/accounting-report";

type MockAccount = {
  id: string;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  currencyCode: string;
};

type MockLine = {
  journalId: string;
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amountMinor: bigint;
};

/**
 * Builds a minimal fake Prisma client backing the two accounting-report queries
 * (`ledgerAccount.findMany` and `journalLine.findMany`) used by getBalanceSheetReport /
 * getTrialBalanceReport, without requiring a real database connection.
 */
function buildLedgerMock(accounts: MockAccount[], lines: MockLine[]) {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  return {
    ledgerAccount: {
      findMany: vi.fn(async ({ where }: { where?: { type?: { in: string[] } } }) =>
        accounts.filter((account) => !where?.type || where.type.in.includes(account.type)),
      ),
    },
    journalLine: {
      findMany: vi.fn(async ({ where }: { where: { account?: { type?: { in: string[] } } } }) =>
        lines
          .filter((line) => {
            const allowedTypes = where.account?.type?.in;
            return !allowedTypes || allowedTypes.includes(accountsById.get(line.accountId)!.type);
          })
          .map((line) => ({
            ...line,
            account: { type: accountsById.get(line.accountId)!.type },
          })),
      ),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

const scope = { organizationId: "org-1", officeIds: null, officerUserId: null } as const;

describe("General Ledger journal details", () => {
  it("limits the full journal to posted entries in the user's organization and permitted offices", async () => {
    const findFirst = vi.fn(async () => null);
    const db = { journal: { findFirst } } as unknown as import("@prisma/client").PrismaClient;
    expect(await getGeneralLedgerJournal(db, { ...scope, officeIds: ["office-1"] }, "journal-1")).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "journal-1", status: "POSTED", office: { organizationId: "org-1" }, officeId: { in: ["office-1"] } },
      include: expect.objectContaining({ lines: expect.objectContaining({ include: { account: true } }) }),
    }));
  });
  it("does not broaden an empty office scope", async () => {
    const findFirst = vi.fn(async () => null);
    const db = { journal: { findFirst } } as unknown as import("@prisma/client").PrismaClient;
    await getGeneralLedgerJournal(db, { ...scope, officeIds: [] }, "journal-1");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ officeId: { in: [] } }) }));
  });
});

describe("General Ledger date ranges", () => {
  it("resolves week, month, and year presets using calendar dates", () => {
    const now = new Date("2026-10-02T17:15:00.000Z");

    expect(resolveDatePreset(now, "week")).toEqual({
      startDate: new Date("2026-09-28T00:00:00.000Z"),
      endDate: new Date("2026-10-02T00:00:00.000Z"),
    });
    expect(resolveDatePreset(now, "month")).toEqual({
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-02T00:00:00.000Z"),
    });
    expect(resolveDatePreset(now, "year")).toEqual({
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-10-02T00:00:00.000Z"),
    });
  });
});

describe("getGeneralLedgerReport", () => {
  it("reports every account line with account, payee, and opening balance details", async () => {
    const accounts: MockAccount[] = [
      { id: "empty", code: "0002443", name: "Advance with no activity", type: "ASSET", currencyCode: "UGX" },
      { id: "cash", code: "10001", name: "Cash", type: "ASSET", currencyCode: "UGX" },
      { id: "loan", code: "10002", name: "Loan Receivables", type: "ASSET", currencyCode: "UGX" },
      { id: "income", code: "30001", name: "Interest Income", type: "REVENUE", currencyCode: "UGX" },
    ];
    const makeLine = (
      id: string,
      accountId: string,
      direction: "DEBIT" | "CREDIT",
      amountMinor: bigint,
      businessDate: string,
      journalId: string,
      payeeName: string | null = null,
    ) => ({
      id,
      journalId,
      direction,
      amountMinor,
      memo: null,
      createdAt: new Date(`${businessDate}T12:00:00.000Z`),
      account: accounts.find((account) => account.id === accountId)!,
      journal: {
        businessDate: new Date(`${businessDate}T00:00:00.000Z`),
        createdAt: new Date(`${businessDate}T12:00:00.000Z`),
        office: { name: "Head Office" },
        payeeType: payeeName ? "PERSON" : null,
        payeeName,
        payeeReference: null,
        referenceType: "MANUAL_INCOME",
        referenceId: journalId,
        narration: "Test journal",
      },
    });
    const periodLines = [
      makeLine("cash-current", "cash", "DEBIT", 3_000n, "2026-09-12", "current", "Robinah Nakaggwe"),
      makeLine("loan-current", "loan", "CREDIT", 3_000n, "2026-09-12", "current", "Robinah Nakaggwe"),
      makeLine("loan-income", "loan", "DEBIT", 3_000n, "2026-09-14", "income"),
      makeLine("income-current", "income", "CREDIT", 3_000n, "2026-09-14", "income"),
    ];
    const db = {
      ledgerAccount: {
        findMany: vi.fn(async () => accounts),
      },
      journalLine: {
        findMany: vi.fn(async ({ where }: { where: { accountId?: string } }) =>
          periodLines.filter((line) => !where.accountId || line.account.id === where.accountId)),
        groupBy: vi.fn(async () => [
          { accountId: "cash", direction: "DEBIT", _sum: { amountMinor: 10_000n } },
          { accountId: "income", direction: "CREDIT", _sum: { amountMinor: 10_000n } },
        ]),
      },
    } as never;

    const report = await getGeneralLedgerReport(db, scope, {
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-30T00:00:00.000Z"),
      officeId: null,
      accountId: null,
    });
    const serialized = serializeGeneralLedgerReport(report);

    expect(report.entries).toHaveLength(4);
    expect(report.entries[0]).toMatchObject({
      account: { code: "10001", name: "Cash" },
      payeeName: "Robinah Nakaggwe",
      runningBalanceMinor: 13_000n,
    });
    expect(report.debitTotalMinor).toBe(6_000n);
    expect(report.creditTotalMinor).toBe(6_000n);
    expect(report.accountBalances.find((balance) => balance.account.id === "cash")).toMatchObject({
      openingBalanceMinor: 10_000n,
      closingBalanceMinor: 13_000n,
    });
    expect(serialized.entries[0]).toMatchObject({
      account: { code: "10001" },
      payeeName: "Robinah Nakaggwe",
    });
    expect(generalLedgerReportCsv(report)).toContain("Robinah Nakaggwe");
    expect(report.account).toBeNull();
    expect(report.lineCount).toBe(4);
    expect(report.journalCount).toBe(2);

    const selected = await getGeneralLedgerReport(db, scope, {
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-30T00:00:00.000Z"),
      officeId: null,
      accountId: "cash",
    });
    expect(selected.account?.id).toBe("cash");
    expect(selected.entries).toHaveLength(1);
    expect(selected.closingBalanceMinor).toBe(13_000n);
    expect(selected.creditTotalMinor).toBe(0n);
    const empty = await getGeneralLedgerReport(db, scope, {
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-30T00:00:00.000Z"),
      officeId: null, accountId: "empty",
    });
    expect(empty.entries).toHaveLength(0);
    expect(empty.accountBalances).toHaveLength(1);
    expect(empty.accountBalances[0]).toMatchObject({ openingBalanceMinor: 0n, closingBalanceMinor: 0n });

    await expect(getGeneralLedgerReport(db, scope, {
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-30T00:00:00.000Z"),
      officeId: null,
      accountId: "missing",
    })).rejects.toThrow("Invalid account filter");
  });
});

describe("getBalanceSheetReport", () => {
  it("balances Assets = Liabilities + Equity for asset/liability/equity-only activity", async () => {
    const accounts: MockAccount[] = [
      { id: "cash", code: "1001", name: "Cash", type: "ASSET", currencyCode: "UGX" },
      { id: "loans-payable", code: "2001", name: "Loans payable", type: "LIABILITY", currencyCode: "UGX" },
      { id: "capital", code: "3001", name: "Share capital", type: "EQUITY", currencyCode: "UGX" },
    ];
    const lines: MockLine[] = [
      { journalId: "j1", accountId: "cash", direction: "DEBIT", amountMinor: 1000n },
      { journalId: "j1", accountId: "capital", direction: "CREDIT", amountMinor: 700n },
      { journalId: "j1", accountId: "loans-payable", direction: "CREDIT", amountMinor: 300n },
    ];

    const report = await getBalanceSheetReport(buildLedgerMock(accounts, lines), scope, {
      endDate: new Date("2024-01-31"),
      officeId: null,
    });

    expect(report.assetsTotalMinor).toBe(1000n);
    expect(report.liabilitiesAndEquityTotalMinor).toBe(1000n);
    expect(report.differenceMinor).toBe(0n);
  });

  it("folds cumulative Revenue minus Expenses into Equity so the sheet still balances (regression: previously ignored Revenue/Expense entirely, leaving Assets != Liabilities + Equity)", async () => {
    const accounts: MockAccount[] = [
      { id: "cash", code: "1001", name: "Cash", type: "ASSET", currencyCode: "UGX" },
      { id: "capital", code: "3001", name: "Share capital", type: "EQUITY", currencyCode: "UGX" },
      { id: "interest-income", code: "4001", name: "Interest income", type: "REVENUE", currencyCode: "UGX" },
      { id: "office-expense", code: "5001", name: "Office expense", type: "EXPENSE", currencyCode: "UGX" },
    ];
    const lines: MockLine[] = [
      // Owner contributes 1,000 cash as capital.
      { journalId: "j1", accountId: "cash", direction: "DEBIT", amountMinor: 1000n },
      { journalId: "j1", accountId: "capital", direction: "CREDIT", amountMinor: 1000n },
      // 500 of interest income received in cash.
      { journalId: "j2", accountId: "cash", direction: "DEBIT", amountMinor: 500n },
      { journalId: "j2", accountId: "interest-income", direction: "CREDIT", amountMinor: 500n },
      // 200 of office expense paid out of cash.
      { journalId: "j3", accountId: "office-expense", direction: "DEBIT", amountMinor: 200n },
      { journalId: "j3", accountId: "cash", direction: "CREDIT", amountMinor: 200n },
    ];

    const report = await getBalanceSheetReport(buildLedgerMock(accounts, lines), scope, {
      endDate: new Date("2024-01-31"),
      officeId: null,
    });

    expect(report.assetsTotalMinor).toBe(1300n); // 1000 + 500 - 200
    expect(report.equityTotalMinor).toBe(1000n); // capital contributions only
    expect(report.netIncomeToDateMinor).toBe(300n); // 500 revenue - 200 expense
    expect(report.liabilitiesAndEquityTotalMinor).toBe(1300n); // equity + net income
    expect(report.differenceMinor).toBe(0n);
  });

  it("reconciles with the Trial Balance's overall debit/credit totals for the same activity", async () => {
    const accounts: MockAccount[] = [
      { id: "cash", code: "1001", name: "Cash", type: "ASSET", currencyCode: "UGX" },
      { id: "capital", code: "3001", name: "Share capital", type: "EQUITY", currencyCode: "UGX" },
      { id: "interest-income", code: "4001", name: "Interest income", type: "REVENUE", currencyCode: "UGX" },
    ];
    const lines: MockLine[] = [
      { journalId: "j1", accountId: "cash", direction: "DEBIT", amountMinor: 1000n },
      { journalId: "j1", accountId: "capital", direction: "CREDIT", amountMinor: 1000n },
      { journalId: "j2", accountId: "cash", direction: "DEBIT", amountMinor: 500n },
      { journalId: "j2", accountId: "interest-income", direction: "CREDIT", amountMinor: 500n },
    ];
    const db = buildLedgerMock(accounts, lines);

    const balanceSheet = await getBalanceSheetReport(db, scope, { endDate: new Date("2024-01-31"), officeId: null });
    const trialBalance = await getTrialBalanceReport(db, scope, {
      startDate: new Date("1970-01-01"),
      endDate: new Date("2024-01-31"),
      officeId: null,
    });

    expect(trialBalance.totalDebitsMinor).toBe(trialBalance.totalCreditsMinor);
    expect(balanceSheet.differenceMinor).toBe(0n);
  });
});

describe("isManualJournalReferenceType", () => {
  it("treats MANUAL_-prefixed reference types as manual", () => {
    expect(isManualJournalReferenceType("MANUAL_INCOME")).toBe(true);
    expect(isManualJournalReferenceType("MANUAL_EXPENSE")).toBe(true);
    expect(isManualJournalReferenceType("MANUAL_FREQUENT_POSTING")).toBe(true);
  });

  it("treats every other reference type as system-generated", () => {
    expect(isManualJournalReferenceType("LOAN_DISBURSEMENT")).toBe(false);
    expect(isManualJournalReferenceType("SAVINGS_TRANSACTION")).toBe(false);
  });
});

describe("resolveEntrySourceFilter", () => {
  it("passes through MANUAL and SYSTEM", () => {
    expect(resolveEntrySourceFilter("MANUAL")).toBe("MANUAL");
    expect(resolveEntrySourceFilter("SYSTEM")).toBe("SYSTEM");
  });

  it("defaults anything else (including null/undefined/garbage) to ALL", () => {
    expect(resolveEntrySourceFilter(null)).toBe("ALL");
    expect(resolveEntrySourceFilter(undefined)).toBe("ALL");
    expect(resolveEntrySourceFilter("bogus")).toBe("ALL");
  });
});

describe("parseAmountFilterMinor / minorToAmountInputValue", () => {
  it("round-trips a decimal amount through minor units", () => {
    expect(parseAmountFilterMinor("500.00")).toBe(50_000n);
    expect(parseAmountFilterMinor("500")).toBe(50_000n);
    expect(parseAmountFilterMinor("12.5")).toBe(1_250n);
    expect(minorToAmountInputValue(50_000n)).toBe("500.00");
    expect(minorToAmountInputValue(1_250n)).toBe("12.50");
  });

  it("rejects invalid input", () => {
    expect(parseAmountFilterMinor("")).toBeNull();
    expect(parseAmountFilterMinor(null)).toBeNull();
    expect(parseAmountFilterMinor("abc")).toBeNull();
    expect(parseAmountFilterMinor("-5")).toBeNull();
  });
});

function buildJournal(overrides: Partial<{ id: string; referenceType: string; referenceId: string | null; narration: string; lines: Array<{ direction: "DEBIT" | "CREDIT"; amountMinor: bigint }> }>) {
  const lines = overrides.lines ?? [
    { direction: "DEBIT" as const, amountMinor: 10_000n },
    { direction: "CREDIT" as const, amountMinor: 10_000n },
  ];
  return {
    id: overrides.id ?? "journal-1",
    businessDate: new Date("2026-09-01T00:00:00.000Z"),
    officeId: "office-1",
    office: { name: "Head Office" },
    referenceType: overrides.referenceType ?? "LOAN_DISBURSEMENT",
    referenceId: overrides.referenceId ?? "txn-1",
    narration: overrides.narration ?? "Test narration",
    status: "POSTED",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    lines: lines.map((line, index) => ({
      id: `line-${index}`,
      direction: line.direction,
      amountMinor: line.amountMinor,
      memo: null,
      account: { id: "account-1", code: "1000", name: "Cash", type: "ASSET", currencyCode: "UGX" },
    })),
  };
}

describe("getJournalReconciliationReport", () => {
  it("builds a MANUAL-only where clause and reports it back on entrySource", async () => {
    const findMany = vi.fn(async () => [buildJournal({ referenceType: "MANUAL_INCOME" })]);
    const db = { journal: { findMany } } as never;
    const report = await getJournalReconciliationReport(db, scope, {
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-30"),
      officeId: null,
      accountId: null,
      entrySource: "MANUAL",
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ referenceType: { startsWith: "MANUAL_" } }) }));
    expect(report.entrySource).toBe("MANUAL");
    expect(report.journalCount).toBe(1);
  });

  it("builds a SYSTEM-only where clause using a negated startsWith", async () => {
    const findMany = vi.fn(async () => [buildJournal({})]);
    const db = { journal: { findMany } } as never;
    await getJournalReconciliationReport(db, scope, {
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-30"),
      officeId: null,
      accountId: null,
      entrySource: "SYSTEM",
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ NOT: { referenceType: { startsWith: "MANUAL_" } } }) }));
  });

  it("includes a case-insensitive OR search across reference, narration, payee, and account name or code", async () => {
    const findMany = vi.fn<(args: { where: { OR?: unknown[] } }) => Promise<never[]>>(async () => []);
    const db = { journal: { findMany } } as never;
    await getJournalReconciliationReport(db, scope, {
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-30"),
      officeId: null,
      accountId: null,
      search: "LN0001",
    });
    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where?.OR).toEqual([
      { referenceId: { contains: "LN0001", mode: "insensitive" } },
      { narration: { contains: "LN0001", mode: "insensitive" } },
      { payeeName: { contains: "LN0001", mode: "insensitive" } },
      { payeeReference: { contains: "LN0001", mode: "insensitive" } },
      {
        lines: {
          some: {
            OR: [
              { memo: { contains: "LN0001", mode: "insensitive" } },
              { account: { name: { contains: "LN0001", mode: "insensitive" } } },
              { account: { code: { contains: "LN0001", mode: "insensitive" } } },
            ],
          },
        },
      },
    ]);
  });

  it("also matches by exact journal id when the search term is a full UUID", async () => {
    const findMany = vi.fn<(args: { where: { OR?: unknown[] } }) => Promise<never[]>>(async () => []);
    const db = { journal: { findMany } } as never;
    const uuid = "11111111-2222-3333-4444-555555555555";
    await getJournalReconciliationReport(db, scope, {
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-30"),
      officeId: null,
      accountId: null,
      search: uuid,
    });
    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where?.OR).toContainEqual({ id: uuid });
  });

  it("filters journals by transaction amount range in-memory and recomputes totals", async () => {
    const journals = [
      buildJournal({ id: "small", lines: [{ direction: "DEBIT", amountMinor: 1_000n }, { direction: "CREDIT", amountMinor: 1_000n }] }),
      buildJournal({ id: "medium", lines: [{ direction: "DEBIT", amountMinor: 10_000n }, { direction: "CREDIT", amountMinor: 10_000n }] }),
      buildJournal({ id: "large", lines: [{ direction: "DEBIT", amountMinor: 100_000n }, { direction: "CREDIT", amountMinor: 100_000n }] }),
    ];
    const findMany = vi.fn(async () => journals);
    const db = { journal: { findMany } } as never;
    const report = await getJournalReconciliationReport(db, scope, {
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-30"),
      officeId: null,
      accountId: null,
      minAmountMinor: 5_000n,
      maxAmountMinor: 50_000n,
    });
    expect(report.journalCount).toBe(1);
    expect(report.journals[0]!.id).toBe("medium");
    expect(report.totalDebitsMinor).toBe(10_000n);
    expect(report.totalCreditsMinor).toBe(10_000n);
  });

  it("still flags unbalanced journals as an issue when no amount filter is applied", async () => {
    const findMany = vi.fn(async () => [buildJournal({ lines: [{ direction: "DEBIT", amountMinor: 10_000n }, { direction: "CREDIT", amountMinor: 9_000n }] })]);
    const db = { journal: { findMany } } as never;
    const report = await getJournalReconciliationReport(db, scope, {
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-30"),
      officeId: null,
      accountId: null,
    });
    expect(report.issueCount).toBe(1);
    expect(report.journals[0]!.isBalanced).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  getBalanceSheetReport,
  getJournalReconciliationReport,
  getTrialBalanceReport,
  isManualJournalReferenceType,
  minorToAmountInputValue,
  parseAmountFilterMinor,
  resolveEntrySourceFilter,
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

const scope = { organizationId: "org-1", officeIds: null, officerUserId: null };

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

  it("includes a case-insensitive OR search across referenceId, narration, and journal id", async () => {
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
  });
});

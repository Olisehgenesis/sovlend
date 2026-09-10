import { describe, expect, it, vi } from "vitest";

import { getBalanceSheetReport, getTrialBalanceReport } from "@/modules/reports/domain/accounting-report";

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

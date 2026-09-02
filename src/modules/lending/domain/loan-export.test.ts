import { describe, expect, it } from "vitest";

import {
  buildExportManifest,
  buildLoanExportDatasets,
  buildNestedExportJson,
  datasetColumns,
  rowsToCsv,
  stringifyBigInts,
  type ExportLoanRecord,
} from "./loan-export";

function makeLoan(overrides: Partial<ExportLoanRecord> = {}): ExportLoanRecord {
  return {
    id: "loan-1",
    accountNumber: "LN0001",
    status: "ACTIVE",
    denominationCurrency: "UGX",
    principalMinor: 1_000_000n,
    disbursedOn: new Date("2026-01-01"),
    maturesOn: new Date("2026-07-01"),
    createdAt: new Date("2025-12-20"),
    officeName: "Kampala HQ",
    clientAccountNumber: "CL0001",
    clientName: "Jane Doe",
    productName: "30 Week Loan",
    loanOfficerName: "Robinah",
    applicationId: "app-1",
    installments: [],
    transactions: [],
    allocations: [],
    charges: [],
    documents: [],
    notes: [],
    collateral: [],
    journals: [],
    journalLines: [],
    auditEvents: [],
    reminders: [],
    ...overrides,
  };
}

describe("buildLoanExportDatasets", () => {
  it("emits one loans row per loan with core fields", () => {
    const datasets = buildLoanExportDatasets([makeLoan()], new Date("2026-06-01"));
    expect(datasets.loans).toHaveLength(1);
    expect(datasets.loans[0]).toMatchObject({ loanId: "loan-1", accountNumber: "LN0001", principalMinor: "1000000" });
  });

  it("computes loan balance totals across original/paid/waived/outstanding/overdue", () => {
    const loan = makeLoan({
      installments: [
        {
          id: "i1", installmentNumber: 1, dueOn: new Date("2026-01-15"),
          principalDueMinor: 100_000n, interestDueMinor: 10_000n, feesDueMinor: 0n, penaltiesDueMinor: 0n,
          principalPaidMinor: 100_000n, interestPaidMinor: 10_000n, feesPaidMinor: 0n, penaltiesPaidMinor: 0n,
          principalWaivedMinor: 0n, interestWaivedMinor: 0n, feesWaivedMinor: 0n, penaltiesWaivedMinor: 0n,
        },
        {
          id: "i2", installmentNumber: 2, dueOn: new Date("2026-02-15"),
          principalDueMinor: 100_000n, interestDueMinor: 10_000n, feesDueMinor: 0n, penaltiesDueMinor: 5_000n,
          principalPaidMinor: 0n, interestPaidMinor: 0n, feesPaidMinor: 0n, penaltiesPaidMinor: 0n,
          principalWaivedMinor: 0n, interestWaivedMinor: 0n, feesWaivedMinor: 0n, penaltiesWaivedMinor: 5_000n,
        },
      ],
    });
    const datasets = buildLoanExportDatasets([loan], new Date("2026-06-01"));
    const balance = datasets.loan_balances[0];
    expect(balance.principalOriginal).toBe("200000");
    expect(balance.principalPaid).toBe("100000");
    expect(balance.principalOutstanding).toBe("100000");
    expect(balance.penaltiesWaived).toBe("5000");
    // Installment 2 is fully overdue as-of 2026-06-01 (principal+interest unpaid, penalties waived)
    expect(balance.totalOverDue).toBe("110000");
    expect(balance.totalWrittenOff).toBe("0");
  });

  it("flags overdue installments and overdue charges in the overdue snapshot", () => {
    const loan = makeLoan({
      installments: [
        {
          id: "i1", installmentNumber: 1, dueOn: new Date("2026-01-01"),
          principalDueMinor: 50_000n, interestDueMinor: 0n, feesDueMinor: 0n, penaltiesDueMinor: 0n,
          principalPaidMinor: 0n, interestPaidMinor: 0n, feesPaidMinor: 0n, penaltiesPaidMinor: 0n,
          principalWaivedMinor: 0n, interestWaivedMinor: 0n, feesWaivedMinor: 0n, penaltiesWaivedMinor: 0n,
        },
      ],
      charges: [{ id: "c1", name: "Processing fee", amountMinor: 5_000n, currencyCode: "UGX", status: "PENDING", dueOn: new Date("2026-01-01") }],
    });
    const datasets = buildLoanExportDatasets([loan], new Date("2026-06-01"));
    expect(datasets.loan_overdue_snapshot).toHaveLength(2);
    expect(datasets.loan_overdue_snapshot.map((row) => row.kind).sort()).toEqual(["CHARGE", "INSTALLMENT"]);
  });

  it("does not flag installments due in the future as overdue", () => {
    const loan = makeLoan({
      installments: [
        {
          id: "i1", installmentNumber: 1, dueOn: new Date("2026-12-01"),
          principalDueMinor: 50_000n, interestDueMinor: 0n, feesDueMinor: 0n, penaltiesDueMinor: 0n,
          principalPaidMinor: 0n, interestPaidMinor: 0n, feesPaidMinor: 0n, penaltiesPaidMinor: 0n,
          principalWaivedMinor: 0n, interestWaivedMinor: 0n, feesWaivedMinor: 0n, penaltiesWaivedMinor: 0n,
        },
      ],
    });
    const datasets = buildLoanExportDatasets([loan], new Date("2026-06-01"));
    expect(datasets.loan_overdue_snapshot).toHaveLength(0);
  });

  it("passes through transactions, allocations, documents, notes, collateral, journals, audit events, and reminders", () => {
    const loan = makeLoan({
      transactions: [{ id: "t1", transactionType: "DISBURSEMENT", businessDate: new Date("2026-01-01"), settlementCurrency: "UGX", settlementChannel: "Cash", settlementAccountName: "Main till", settlementAmountMinor: 1_000_000n, denominationAmountMinor: 1_000_000n, externalReference: null, idempotencyKey: "idem-1", reversedById: null, reversesId: null, createdAt: new Date("2026-01-01") }],
      allocations: [{ id: "a1", transactionId: "t1", installmentId: "i1", principalMinor: 100_000n, interestMinor: 10_000n, feesMinor: 0n, penaltiesMinor: 0n }],
      documents: [{ id: "d1", name: "ID copy", description: null, mediaType: "image/png", sha256: "abc", objectKey: "abc", createdAt: new Date("2026-01-01") }],
      notes: [{ id: "n1", body: "Called client", authorName: "Robinah", createdAt: new Date("2026-01-01") }],
      collateral: [{ id: "col1", type: "VEHICLE", description: "Toyota", estimatedValueMinor: 5_000_000n, valuationCurrencyCode: "UGX", valuationDate: new Date("2026-01-01"), status: "ACTIVE" }],
      journals: [{ id: "j1", referenceType: "LOAN_DISBURSEMENT", referenceId: "t1", businessDate: new Date("2026-01-01"), narration: "Disbursement LN0001", status: "POSTED", postedAt: new Date("2026-01-01") }],
      journalLines: [{ id: "jl1", journalId: "j1", accountName: "Loans receivable", direction: "DEBIT", amountMinor: 1_000_000n, memo: null }],
      auditEvents: [{ id: "ae1", action: "loan.disbursed", entityType: "Loan", entityId: "loan-1", actorName: "Robinah", occurredAt: new Date("2026-01-01"), metadata: { amountMinor: "1000000" } }],
      reminders: [{ id: "r1", installmentId: "i1", type: "REPAYMENT_DUE_SOON", status: "SENT", scheduledFor: new Date("2026-01-10"), attempts: 1, sentAt: new Date("2026-01-10") }],
    });
    const datasets = buildLoanExportDatasets([loan], new Date("2026-06-01"));
    expect(datasets.loan_transactions).toHaveLength(1);
    expect(datasets.loan_transaction_allocations).toHaveLength(1);
    expect(datasets.loan_documents).toHaveLength(1);
    expect(datasets.loan_notes).toHaveLength(1);
    expect(datasets.loan_collateral).toHaveLength(1);
    expect(datasets.loan_journals).toHaveLength(1);
    expect(datasets.loan_journal_lines).toHaveLength(1);
    expect(datasets.loan_audit_events).toHaveLength(1);
    expect(datasets.loan_reminders).toHaveLength(1);
    expect(datasets.loan_audit_events[0].metadata).toBe('{"amountMinor":"1000000"}');
  });
});

describe("rowsToCsv", () => {
  it("renders a BOM-prefixed, CRLF-delimited, fully-quoted CSV", () => {
    const csv = rowsToCsv([{ a: "1", b: "hello, world" }], ["a", "b"]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"a\",\"b\"\r\n");
    expect(csv).toContain("\"1\",\"hello, world\"\r\n");
  });

  it("defeats formula injection by escaping leading =, +, -, @", () => {
    const csv = rowsToCsv([{ a: "=SUM(A1:A2)" }], ["a"]);
    expect(csv).toContain("\"'=SUM(A1:A2)\"");
  });

  it("has column definitions for every dataset key", () => {
    const datasets = buildLoanExportDatasets([makeLoan()], new Date("2026-06-01"));
    for (const key of Object.keys(datasets)) {
      expect(datasetColumns).toHaveProperty(key);
    }
  });
});

describe("buildExportManifest", () => {
  it("reports dataset counts, as-of date, and scope metadata", () => {
    const datasets = buildLoanExportDatasets([makeLoan()], new Date("2026-06-01"));
    const manifest = buildExportManifest(datasets, { asOfDate: new Date("2026-06-01"), scopeType: "SINGLE_LOAN", scopeParams: { loanId: "loan-1" }, loanCount: 1 });
    expect(manifest.asOfDate).toBe("2026-06-01");
    expect(manifest.loanCount).toBe(1);
    expect(manifest.datasetCounts.loans).toBe(1);
    expect(manifest.scopeType).toBe("SINGLE_LOAN");
  });
});

describe("stringifyBigInts", () => {
  it("converts nested bigints and dates recursively", () => {
    const result = stringifyBigInts({ amount: 100n, nested: [{ inner: 5n, date: new Date("2026-01-01T00:00:00.000Z") }], text: "keep" });
    expect(result).toEqual({ amount: "100", nested: [{ inner: "5", date: "2026-01-01T00:00:00.000Z" }], text: "keep" });
  });
});

describe("buildNestedExportJson", () => {
  it("nests every dataset under its owning loan alongside the manifest", () => {
    const loan = makeLoan({
      installments: [
        {
          id: "i1", installmentNumber: 1, dueOn: new Date("2026-01-15"),
          principalDueMinor: 100_000n, interestDueMinor: 10_000n, feesDueMinor: 0n, penaltiesDueMinor: 0n,
          principalPaidMinor: 0n, interestPaidMinor: 0n, feesPaidMinor: 0n, penaltiesPaidMinor: 0n,
          principalWaivedMinor: 0n, interestWaivedMinor: 0n, feesWaivedMinor: 0n, penaltiesWaivedMinor: 0n,
        },
      ],
    });
    const asOfDate = new Date("2026-06-01");
    const datasets = buildLoanExportDatasets([loan], asOfDate);
    const manifest = buildExportManifest(datasets, { asOfDate, scopeType: "SINGLE_LOAN", scopeParams: { loanId: "loan-1" }, loanCount: 1 });
    const nested = buildNestedExportJson([loan], datasets, manifest) as { manifest: unknown; loans: Array<{ loan: { loanId: string }; schedule: unknown[] }> };
    expect(nested.loans).toHaveLength(1);
    expect(nested.loans[0].loan.loanId).toBe("loan-1");
    expect(nested.loans[0].schedule).toHaveLength(1);
    expect(nested.manifest).toBeTruthy();
  });
});

// Agent 6: Full-Fidelity Loan Export — pure domain logic.
//
// This module has no Prisma/IO dependency so it can be unit tested directly: given a plain,
// already-loaded `ExportLoanRecord[]` (assembled by the application layer from the database),
// it produces the CSV/JSON datasets and manifest described in docs/loan.md's "Export
// Requirement" section, matching the legacy loan-export file set exactly:
// loans, loan_balances, loan_schedule, loan_transactions, loan_transaction_allocations,
// loan_charges, loan_overdue_snapshot, loan_documents, loan_notes, loan_collateral,
// loan_journals, loan_journal_lines, loan_audit_events, loan_reminders.

export type ExportInstallment = Readonly<{
  id: string;
  installmentNumber: number;
  dueOn: Date;
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  feesDueMinor: bigint;
  penaltiesDueMinor: bigint;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  feesPaidMinor: bigint;
  penaltiesPaidMinor: bigint;
  principalWaivedMinor: bigint;
  interestWaivedMinor: bigint;
  feesWaivedMinor: bigint;
  penaltiesWaivedMinor: bigint;
}>;

export type ExportTransaction = Readonly<{
  id: string;
  transactionType: string;
  businessDate: Date;
  settlementCurrency: string;
  settlementChannel: string;
  settlementAccountName: string | null;
  settlementAmountMinor: bigint;
  denominationAmountMinor: bigint;
  externalReference: string | null;
  idempotencyKey: string;
  reversedById: string | null;
  reversesId: string | null;
  createdAt: Date;
}>;

export type ExportAllocation = Readonly<{
  id: string;
  transactionId: string;
  installmentId: string;
  principalMinor: bigint;
  interestMinor: bigint;
  feesMinor: bigint;
  penaltiesMinor: bigint;
}>;

export type ExportCharge = Readonly<{
  id: string;
  name: string;
  amountMinor: bigint;
  currencyCode: string;
  status: string;
  dueOn: Date | null;
}>;

export type ExportDocument = Readonly<{
  id: string;
  name: string;
  description: string | null;
  mediaType: string;
  sha256: string;
  objectKey: string;
  createdAt: Date;
}>;

export type ExportNote = Readonly<{
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
}>;

export type ExportCollateral = Readonly<{
  id: string;
  type: string;
  description: string | null;
  estimatedValueMinor: bigint | null;
  valuationCurrencyCode: string;
  valuationDate: Date | null;
  status: string;
}>;

export type ExportJournal = Readonly<{
  id: string;
  referenceType: string;
  referenceId: string | null;
  businessDate: Date;
  narration: string;
  status: string;
  postedAt: Date | null;
}>;

export type ExportJournalLine = Readonly<{
  id: string;
  journalId: string;
  accountName: string;
  direction: string;
  amountMinor: bigint;
  memo: string | null;
}>;

export type ExportAuditEvent = Readonly<{
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  occurredAt: Date;
  metadata: unknown;
}>;

export type ExportReminder = Readonly<{
  id: string;
  installmentId: string;
  type: string;
  status: string;
  scheduledFor: Date;
  attempts: number;
  sentAt: Date | null;
}>;

export type ExportLoanRecord = Readonly<{
  id: string;
  accountNumber: string;
  status: string;
  denominationCurrency: string;
  principalMinor: bigint;
  disbursedOn: Date | null;
  maturesOn: Date | null;
  createdAt: Date;
  officeName: string;
  clientAccountNumber: string;
  clientName: string;
  productName: string;
  loanOfficerName: string | null;
  applicationId: string;
  installments: readonly ExportInstallment[];
  transactions: readonly ExportTransaction[];
  allocations: readonly ExportAllocation[];
  charges: readonly ExportCharge[];
  documents: readonly ExportDocument[];
  notes: readonly ExportNote[];
  collateral: readonly ExportCollateral[];
  journals: readonly ExportJournal[];
  journalLines: readonly ExportJournalLine[];
  auditEvents: readonly ExportAuditEvent[];
  reminders: readonly ExportReminder[];
}>;

export type CsvRow = Record<string, string>;

function money(value: bigint): string {
  return value.toString();
}

function isoDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function isoDateTime(value: Date | null): string {
  return value ? value.toISOString() : "";
}

function installmentOutstanding(item: ExportInstallment): bigint {
  return (
    item.principalDueMinor +
    item.interestDueMinor +
    item.feesDueMinor +
    item.penaltiesDueMinor -
    item.principalPaidMinor -
    item.interestPaidMinor -
    item.feesPaidMinor -
    item.penaltiesPaidMinor -
    item.principalWaivedMinor -
    item.interestWaivedMinor -
    item.feesWaivedMinor -
    item.penaltiesWaivedMinor
  );
}

export type LoanExportDatasets = Readonly<{
  loans: CsvRow[];
  loan_balances: CsvRow[];
  loan_schedule: CsvRow[];
  loan_transactions: CsvRow[];
  loan_transaction_allocations: CsvRow[];
  loan_charges: CsvRow[];
  loan_overdue_snapshot: CsvRow[];
  loan_documents: CsvRow[];
  loan_notes: CsvRow[];
  loan_collateral: CsvRow[];
  loan_journals: CsvRow[];
  loan_journal_lines: CsvRow[];
  loan_audit_events: CsvRow[];
  loan_reminders: CsvRow[];
}>;

/** Builds the full CSV/JSON dataset set for a batch of loans, as-of a given business date. */
export function buildLoanExportDatasets(records: readonly ExportLoanRecord[], asOfDate: Date): LoanExportDatasets {
  const datasets: LoanExportDatasets = {
    loans: [],
    loan_balances: [],
    loan_schedule: [],
    loan_transactions: [],
    loan_transaction_allocations: [],
    loan_charges: [],
    loan_overdue_snapshot: [],
    loan_documents: [],
    loan_notes: [],
    loan_collateral: [],
    loan_journals: [],
    loan_journal_lines: [],
    loan_audit_events: [],
    loan_reminders: [],
  };

  for (const loan of records) {
    datasets.loans.push({
      loanId: loan.id,
      accountNumber: loan.accountNumber,
      applicationId: loan.applicationId,
      status: loan.status,
      currency: loan.denominationCurrency,
      principalMinor: money(loan.principalMinor),
      office: loan.officeName,
      client: loan.clientName,
      clientAccountNumber: loan.clientAccountNumber,
      product: loan.productName,
      loanOfficer: loan.loanOfficerName ?? "",
      disbursedOn: isoDate(loan.disbursedOn),
      maturesOn: isoDate(loan.maturesOn),
      createdAt: isoDateTime(loan.createdAt),
    });

    const totals = loan.installments.reduce(
      (sum, item) => ({
        principalDue: sum.principalDue + item.principalDueMinor,
        interestDue: sum.interestDue + item.interestDueMinor,
        feesDue: sum.feesDue + item.feesDueMinor,
        penaltiesDue: sum.penaltiesDue + item.penaltiesDueMinor,
        principalPaid: sum.principalPaid + item.principalPaidMinor,
        interestPaid: sum.interestPaid + item.interestPaidMinor,
        feesPaid: sum.feesPaid + item.feesPaidMinor,
        penaltiesPaid: sum.penaltiesPaid + item.penaltiesPaidMinor,
        principalWaived: sum.principalWaived + item.principalWaivedMinor,
        interestWaived: sum.interestWaived + item.interestWaivedMinor,
        feesWaived: sum.feesWaived + item.feesWaivedMinor,
        penaltiesWaived: sum.penaltiesWaived + item.penaltiesWaivedMinor,
        overdue: sum.overdue + (item.dueOn < asOfDate ? installmentOutstanding(item) : 0n),
      }),
      {
        principalDue: 0n, interestDue: 0n, feesDue: 0n, penaltiesDue: 0n,
        principalPaid: 0n, interestPaid: 0n, feesPaid: 0n, penaltiesPaid: 0n,
        principalWaived: 0n, interestWaived: 0n, feesWaived: 0n, penaltiesWaived: 0n,
        overdue: 0n,
      },
    );
    const components = [
      { key: "principal", due: totals.principalDue, paid: totals.principalPaid, waived: totals.principalWaived },
      { key: "interest", due: totals.interestDue, paid: totals.interestPaid, waived: totals.interestWaived },
      { key: "fees", due: totals.feesDue, paid: totals.feesPaid, waived: totals.feesWaived },
      { key: "penalties", due: totals.penaltiesDue, paid: totals.penaltiesPaid, waived: totals.penaltiesWaived },
    ];
    const balanceRow: CsvRow = { loanId: loan.id, accountNumber: loan.accountNumber, asOfDate: isoDate(asOfDate) };
    let totalOriginal = 0n;
    let totalPaid = 0n;
    let totalWaived = 0n;
    for (const component of components) {
      const outstanding = component.due - component.paid - component.waived;
      balanceRow[`${component.key}Original`] = money(component.due);
      balanceRow[`${component.key}Paid`] = money(component.paid);
      balanceRow[`${component.key}Waived`] = money(component.waived);
      // No write-off action exists in the codebase yet (permissions.loanWriteOff is defined but
      // unused); the column is reserved so the CSV shape matches the legacy breakdown table.
      balanceRow[`${component.key}WrittenOff`] = "0";
      balanceRow[`${component.key}Outstanding`] = money(outstanding);
      totalOriginal += component.due;
      totalPaid += component.paid;
      totalWaived += component.waived;
    }
    balanceRow.totalOriginal = money(totalOriginal);
    balanceRow.totalPaid = money(totalPaid);
    balanceRow.totalWaived = money(totalWaived);
    balanceRow.totalWrittenOff = "0";
    balanceRow.totalOutstanding = money(totalOriginal - totalPaid - totalWaived);
    balanceRow.totalOverDue = money(totals.overdue);
    datasets.loan_balances.push(balanceRow);

    for (const item of loan.installments) {
      const outstanding = installmentOutstanding(item);
      datasets.loan_schedule.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        installmentNumber: String(item.installmentNumber),
        dueOn: isoDate(item.dueOn),
        principalDueMinor: money(item.principalDueMinor),
        interestDueMinor: money(item.interestDueMinor),
        feesDueMinor: money(item.feesDueMinor),
        penaltiesDueMinor: money(item.penaltiesDueMinor),
        principalPaidMinor: money(item.principalPaidMinor),
        interestPaidMinor: money(item.interestPaidMinor),
        feesPaidMinor: money(item.feesPaidMinor),
        penaltiesPaidMinor: money(item.penaltiesPaidMinor),
        principalWaivedMinor: money(item.principalWaivedMinor),
        interestWaivedMinor: money(item.interestWaivedMinor),
        feesWaivedMinor: money(item.feesWaivedMinor),
        penaltiesWaivedMinor: money(item.penaltiesWaivedMinor),
        outstandingMinor: money(outstanding),
      });
      if (item.dueOn < asOfDate && outstanding > 0n) {
        datasets.loan_overdue_snapshot.push({
          loanId: loan.id,
          accountNumber: loan.accountNumber,
          kind: "INSTALLMENT",
          reference: String(item.installmentNumber),
          dueOn: isoDate(item.dueOn),
          outstandingMinor: money(outstanding),
          currency: loan.denominationCurrency,
          asOfDate: isoDate(asOfDate),
        });
      }
    }

    for (const charge of loan.charges) {
      datasets.loan_charges.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        chargeId: charge.id,
        name: charge.name,
        amountMinor: money(charge.amountMinor),
        currency: charge.currencyCode,
        status: charge.status,
        dueOn: isoDate(charge.dueOn),
      });
      if (charge.status === "PENDING" && charge.dueOn && charge.dueOn < asOfDate) {
        datasets.loan_overdue_snapshot.push({
          loanId: loan.id,
          accountNumber: loan.accountNumber,
          kind: "CHARGE",
          reference: charge.name,
          dueOn: isoDate(charge.dueOn),
          outstandingMinor: money(charge.amountMinor),
          currency: charge.currencyCode,
          asOfDate: isoDate(asOfDate),
        });
      }
    }

    for (const transaction of loan.transactions) {
      datasets.loan_transactions.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        transactionId: transaction.id,
        transactionType: transaction.transactionType,
        businessDate: isoDate(transaction.businessDate),
        settlementCurrency: transaction.settlementCurrency,
        settlementChannel: transaction.settlementChannel,
        settlementAccount: transaction.settlementAccountName ?? "",
        settlementAmountMinor: money(transaction.settlementAmountMinor),
        denominationAmountMinor: money(transaction.denominationAmountMinor),
        externalReference: transaction.externalReference ?? "",
        idempotencyKey: transaction.idempotencyKey,
        reversedById: transaction.reversedById ?? "",
        reversesId: transaction.reversesId ?? "",
        createdAt: isoDateTime(transaction.createdAt),
      });
    }

    for (const allocation of loan.allocations) {
      datasets.loan_transaction_allocations.push({
        loanId: loan.id,
        transactionId: allocation.transactionId,
        installmentId: allocation.installmentId,
        principalMinor: money(allocation.principalMinor),
        interestMinor: money(allocation.interestMinor),
        feesMinor: money(allocation.feesMinor),
        penaltiesMinor: money(allocation.penaltiesMinor),
      });
    }

    for (const document of loan.documents) {
      datasets.loan_documents.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        documentId: document.id,
        name: document.name,
        description: document.description ?? "",
        mediaType: document.mediaType,
        sha256: document.sha256,
        objectKey: document.objectKey,
        createdAt: isoDateTime(document.createdAt),
      });
    }

    for (const note of loan.notes) {
      datasets.loan_notes.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        noteId: note.id,
        body: note.body,
        author: note.authorName,
        createdAt: isoDateTime(note.createdAt),
      });
    }

    for (const item of loan.collateral) {
      datasets.loan_collateral.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        collateralId: item.id,
        type: item.type,
        description: item.description ?? "",
        estimatedValueMinor: item.estimatedValueMinor !== null ? money(item.estimatedValueMinor) : "",
        currency: item.valuationCurrencyCode,
        valuationDate: isoDate(item.valuationDate),
        status: item.status,
      });
    }

    for (const journal of loan.journals) {
      datasets.loan_journals.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        journalId: journal.id,
        referenceType: journal.referenceType,
        referenceId: journal.referenceId ?? "",
        businessDate: isoDate(journal.businessDate),
        narration: journal.narration,
        status: journal.status,
        postedAt: isoDateTime(journal.postedAt),
      });
    }

    for (const line of loan.journalLines) {
      datasets.loan_journal_lines.push({
        loanId: loan.id,
        journalId: line.journalId,
        journalLineId: line.id,
        account: line.accountName,
        direction: line.direction,
        amountMinor: money(line.amountMinor),
        memo: line.memo ?? "",
      });
    }

    for (const event of loan.auditEvents) {
      datasets.loan_audit_events.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        auditEventId: event.id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        actor: event.actorName ?? "system",
        occurredAt: isoDateTime(event.occurredAt),
        metadata: JSON.stringify(event.metadata ?? {}),
      });
    }

    for (const reminder of loan.reminders) {
      datasets.loan_reminders.push({
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        reminderId: reminder.id,
        installmentId: reminder.installmentId,
        type: reminder.type,
        status: reminder.status,
        scheduledFor: isoDateTime(reminder.scheduledFor),
        attempts: String(reminder.attempts),
        sentAt: isoDateTime(reminder.sentAt),
      });
    }
  }

  return datasets;
}

/**
 * Renders one dataset of rows to a CSV string. Follows the same defensive-escaping convention
 * used by the existing /api/loans/export route: UTF-8 BOM, CRLF line endings, every cell quoted,
 * and a leading apostrophe on any cell starting with =, +, -, or @ to defeat formula injection
 * when the file is opened in a spreadsheet application.
 */
export function rowsToCsv(rows: readonly CsvRow[], columns: readonly string[]): string {
  const header = columns.map(csvCell).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(","));
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export const datasetColumns: Record<keyof LoanExportDatasets, readonly string[]> = {
  loans: ["loanId", "accountNumber", "applicationId", "status", "currency", "principalMinor", "office", "client", "clientAccountNumber", "product", "loanOfficer", "disbursedOn", "maturesOn", "createdAt"],
  loan_balances: [
    "loanId", "accountNumber", "asOfDate",
    "principalOriginal", "principalPaid", "principalWaived", "principalWrittenOff", "principalOutstanding",
    "interestOriginal", "interestPaid", "interestWaived", "interestWrittenOff", "interestOutstanding",
    "feesOriginal", "feesPaid", "feesWaived", "feesWrittenOff", "feesOutstanding",
    "penaltiesOriginal", "penaltiesPaid", "penaltiesWaived", "penaltiesWrittenOff", "penaltiesOutstanding",
    "totalOriginal", "totalPaid", "totalWaived", "totalWrittenOff", "totalOutstanding", "totalOverDue",
  ],
  loan_schedule: ["loanId", "accountNumber", "installmentNumber", "dueOn", "principalDueMinor", "interestDueMinor", "feesDueMinor", "penaltiesDueMinor", "principalPaidMinor", "interestPaidMinor", "feesPaidMinor", "penaltiesPaidMinor", "principalWaivedMinor", "interestWaivedMinor", "feesWaivedMinor", "penaltiesWaivedMinor", "outstandingMinor"],
  loan_transactions: ["loanId", "accountNumber", "transactionId", "transactionType", "businessDate", "settlementCurrency", "settlementChannel", "settlementAccount", "settlementAmountMinor", "denominationAmountMinor", "externalReference", "idempotencyKey", "reversedById", "reversesId", "createdAt"],
  loan_transaction_allocations: ["loanId", "transactionId", "installmentId", "principalMinor", "interestMinor", "feesMinor", "penaltiesMinor"],
  loan_charges: ["loanId", "accountNumber", "chargeId", "name", "amountMinor", "currency", "status", "dueOn"],
  loan_overdue_snapshot: ["loanId", "accountNumber", "kind", "reference", "dueOn", "outstandingMinor", "currency", "asOfDate"],
  loan_documents: ["loanId", "accountNumber", "documentId", "name", "description", "mediaType", "sha256", "objectKey", "createdAt"],
  loan_notes: ["loanId", "accountNumber", "noteId", "body", "author", "createdAt"],
  loan_collateral: ["loanId", "accountNumber", "collateralId", "type", "description", "estimatedValueMinor", "currency", "valuationDate", "status"],
  loan_journals: ["loanId", "accountNumber", "journalId", "referenceType", "referenceId", "businessDate", "narration", "status", "postedAt"],
  loan_journal_lines: ["loanId", "journalId", "journalLineId", "account", "direction", "amountMinor", "memo"],
  loan_audit_events: ["loanId", "accountNumber", "auditEventId", "action", "entityType", "entityId", "actor", "occurredAt", "metadata"],
  loan_reminders: ["loanId", "accountNumber", "reminderId", "installmentId", "type", "status", "scheduledFor", "attempts", "sentAt"],
};

export type ExportManifest = Readonly<{
  generatedAt: string;
  asOfDate: string;
  scopeType: string;
  scopeParams: unknown;
  loanCount: number;
  datasetCounts: Record<string, number>;
}>;

/** Builds the export manifest: counts, as-of date, and scope metadata (per docs/loan.md). */
export function buildExportManifest(
  datasets: LoanExportDatasets,
  input: { asOfDate: Date; scopeType: string; scopeParams: unknown; loanCount: number },
): ExportManifest {
  const datasetCounts: Record<string, number> = {};
  for (const key of Object.keys(datasets) as (keyof LoanExportDatasets)[]) {
    datasetCounts[key] = datasets[key].length;
  }
  return {
    generatedAt: new Date().toISOString(),
    asOfDate: isoDate(input.asOfDate),
    scopeType: input.scopeType,
    scopeParams: input.scopeParams,
    loanCount: input.loanCount,
    datasetCounts,
  };
}

/**
 * Nests the flat CSV-style datasets back into a canonical per-loan JSON structure for the
 * JSON export package — one object per loan with all of its child records embedded, plus the
 * top-level manifest. This is what integrations and full-lifecycle reconstruction consume.
 */
export function buildNestedExportJson(
  records: readonly ExportLoanRecord[],
  datasets: LoanExportDatasets,
  manifest: ExportManifest,
): unknown {
  return stringifyBigInts({
    manifest,
    loans: records.map((record) => ({
      loan: datasets.loans.find((row) => row.loanId === record.id) ?? null,
      balances: datasets.loan_balances.find((row) => row.loanId === record.id) ?? null,
      schedule: datasets.loan_schedule.filter((row) => row.loanId === record.id),
      transactions: datasets.loan_transactions.filter((row) => row.loanId === record.id),
      transactionAllocations: datasets.loan_transaction_allocations.filter((row) => row.loanId === record.id),
      charges: datasets.loan_charges.filter((row) => row.loanId === record.id),
      overdueSnapshot: datasets.loan_overdue_snapshot.filter((row) => row.loanId === record.id),
      documents: datasets.loan_documents.filter((row) => row.loanId === record.id),
      notes: datasets.loan_notes.filter((row) => row.loanId === record.id),
      collateral: datasets.loan_collateral.filter((row) => row.loanId === record.id),
      journals: datasets.loan_journals.filter((row) => row.loanId === record.id),
      journalLines: datasets.loan_journal_lines.filter((row) => row.loanId === record.id),
      auditEvents: datasets.loan_audit_events.filter((row) => row.loanId === record.id),
      reminders: datasets.loan_reminders.filter((row) => row.loanId === record.id),
    })),
  });
}

/** Converts every BigInt in a JSON-serializable value tree to a string, recursively. */
export function stringifyBigInts<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stringifyBigInts);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stringifyBigInts(entry)]));
  }
  return value;
}

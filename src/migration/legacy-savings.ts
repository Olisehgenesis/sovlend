import { toMinor } from "./money";

export type LegacySavingsTransaction = Record<string, unknown>;

export type PlannedSavingsTransactionImport = Readonly<{
  legacyTransactionId: number;
  transactionType: string;
  amountMinor: bigint;
  externalReference: string;
  idempotencyKey: string;
  createdAt: Date;
}>;

export function legacySavingsAccountIdFromAccountNumber(accountNumber: string): number | null {
  if (!/^\d+$/.test(accountNumber)) return null;
  const legacySavingsAccountId = Number.parseInt(accountNumber, 10);
  if (!Number.isInteger(legacySavingsAccountId) || legacySavingsAccountId <= 0) return null;
  return String(legacySavingsAccountId).padStart(accountNumber.length, "0") === accountNumber ? legacySavingsAccountId : null;
}

export function extractSavingsAccountIdsFromAccountsPayload(payload: unknown): number[] {
  const record = asRecord(payload);
  const savingsAccounts = Array.isArray(record?.savingsAccounts) ? record.savingsAccounts : [];
  const ids = new Set<number>();

  for (const entry of savingsAccounts) {
    const legacySavingsAccountId = asNumber(asRecord(entry)?.id);
    if (legacySavingsAccountId !== null) ids.add(legacySavingsAccountId);
  }

  return [...ids];
}

export function planLegacySavingsTransactionImports(
  accountNumber: string,
  payload: unknown,
  existingIdempotencyKeys: ReadonlySet<string> = new Set(),
): Readonly<{ transactionsToCreate: PlannedSavingsTransactionImport[]; skipped: string[] }> {
  const savingsAccount = asRecord(payload);
  const currency = asRecord(savingsAccount?.currency);
  const exponent = asNumber(currency?.decimalPlaces) ?? 2;
  const legacySavingsAccountId = asNumber(savingsAccount?.id) ?? legacySavingsAccountIdFromAccountNumber(accountNumber);
  const skipped: string[] = [];

  if (legacySavingsAccountId === null) {
    return {
      transactionsToCreate: [],
      skipped: [`${accountNumber}: invalid legacy savings account id`],
    };
  }

  const transactionsToCreate: PlannedSavingsTransactionImport[] = [];
  for (const transaction of asTransactions(savingsAccount?.transactions)) {
    const legacyTransactionId = asNumber(transaction.id);
    if (legacyTransactionId === null) {
      skipped.push(`${accountNumber}: encountered transaction without numeric id`);
      continue;
    }

    const idempotencyKey = `savings-tx-${legacySavingsAccountId}-${legacyTransactionId}`;
    if (existingIdempotencyKeys.has(idempotencyKey)) continue;

    transactionsToCreate.push({
      legacyTransactionId,
      transactionType: asString(asRecord(transaction.transactionType)?.value) ?? "Unknown",
      amountMinor: signedLegacySavingsAmountMinor(transaction, exponent),
      externalReference: String(legacyTransactionId),
      idempotencyKey,
      createdAt: dateFromParts(transaction.date) ?? new Date(),
    });
  }

  return { transactionsToCreate, skipped };
}

export function dateFromParts(value: unknown): Date | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [year, month, day] = value as number[];
  return new Date(Date.UTC(year, month - 1, day));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signedLegacySavingsAmountMinor(transaction: LegacySavingsTransaction, exponent: number): bigint {
  if (transaction.reversed === true) return 0n;

  const amountMinor = toMinor(asNumber(transaction.amount) ?? 0, exponent);
  const transactionType = asRecord(transaction.transactionType);

  if (
    transactionType?.deposit === true ||
    transactionType?.dividendPayout === true ||
    transactionType?.interestPosting === true ||
    transactionType?.approveTransfer === true ||
    transactionType?.amountRelease === true ||
    transactionType?.rejectTransfer === true
  ) {
    return amountMinor;
  }

  if (
    transactionType?.withdrawal === true ||
    transactionType?.feeDeduction === true ||
    transactionType?.initiateTransfer === true ||
    transactionType?.withdrawTransfer === true ||
    transactionType?.overdraftInterest === true ||
    transactionType?.overdraftFee === true ||
    transactionType?.withholdTax === true ||
    transactionType?.escheat === true ||
    transactionType?.amountHold === true ||
    transactionType?.writtenoff === true
  ) {
    return -amountMinor;
  }

  return amountMinor;
}

function asTransactions(value: unknown): LegacySavingsTransaction[] {
  return Array.isArray(value) ? value.map(asRecord).filter((entry): entry is LegacySavingsTransaction => entry !== null) : [];
}

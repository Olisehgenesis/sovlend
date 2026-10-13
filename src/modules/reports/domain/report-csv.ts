import { rowsToCsv, type CsvRow } from "@/modules/lending/domain/loan-export";

const MONEY_COLUMN = /(amount|principal|interest|balance|fees?|penalt|debit|credit|outstanding|arrears|overdue|repaid|recovery|recover|provision|savings|receipt|expected|exposure|written.?off|current|opening|closing|collected|waived|paid|disbursed|due|liabilit|assets|equity|income|revenue|expenses|value|difference|portfolio|net worth)/i;
const NON_MONEY_COLUMN = /(count|number of|rate|percent|%|days|loans|accounts|transactions|installments|ratio|date|period|cohort|concentration)/i;

function currencyDivisor(currencyCode: string): bigint | null {
  switch (currencyCode.toUpperCase()) {
    case "UGX":
    case "USD":
      return 100n;
    case "USDC":
      return 1_000_000n;
    case "BTC":
      return 100_000_000n;
    default:
      return null;
  }
}

function toMajorAmount(value: string, currencyCode: string): string {
  const divisor = currencyDivisor(currencyCode);
  if (divisor === null || !/^-?\d+$/.test(value)) return value;

  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    return value;
  }

  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const sign = negative ? "-" : "";

  if (currencyCode.toUpperCase() === "UGX") {
    return `${sign}${(absolute + divisor / 2n) / divisor}`;
  }

  const decimals = divisor === 100n ? 2 : divisor === 1_000_000n ? 6 : 8;
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(decimals, "0");
  return `${sign}${whole}.${fraction}`;
}

/**
 * Report rows store money in minor units. Convert only monetary CSV columns to major units
 * before download, leaving counts, rates, dates, and the full-fidelity loan archive untouched.
 */
export function reportRowsToCsv(rows: readonly CsvRow[], columns: readonly string[]): string {
  const convertedRows = rows.map((row) => {
    const currencyCode = row.Currency ?? row.currencyCode ?? "UGX";
    const converted: CsvRow = { ...row };

    for (const column of columns) {
      if (!MONEY_COLUMN.test(column) || NON_MONEY_COLUMN.test(column)) continue;
      converted[column] = toMajorAmount(row[column] ?? "", currencyCode);
    }
    return converted;
  });

  return rowsToCsv(convertedRows, columns);
}

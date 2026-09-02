export type JournalDraftLine = Readonly<{
  accountId: string;
  currencyCode: string;
  direction: "DEBIT" | "CREDIT";
  amountMinor: bigint;
}>;

export function assertBalancedJournal(lines: readonly JournalDraftLine[]): void {
  if (lines.length < 2) {
    throw new Error("A journal requires at least two lines");
  }

  const totals = new Map<string, { debit: bigint; credit: bigint }>();

  for (const line of lines) {
    if (line.amountMinor <= 0n) {
      throw new Error("Journal amounts must be positive");
    }

    const total = totals.get(line.currencyCode) ?? { debit: 0n, credit: 0n };
    total[line.direction.toLowerCase() as "debit" | "credit"] += line.amountMinor;
    totals.set(line.currencyCode, total);
  }

  for (const [currency, total] of totals) {
    if (total.debit !== total.credit) {
      throw new Error(`Journal is not balanced for ${currency}`);
    }
  }
}
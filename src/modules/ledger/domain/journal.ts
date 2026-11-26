export type JournalDraftLine = Readonly<{
  accountId: string;
  currencyCode: string;
  direction: "DEBIT" | "CREDIT";
  amountMinor: bigint;
}>;

// Who/what actually received (expense, disbursement) or sent (income) the money, as distinct
// from the settlement account (the institution's own cash/bank/momo account the money moved
// through). Shared by manual journal entries and loan disbursement -- any flow that records a
// cash-out/cash-in destination should reuse this list rather than inventing its own.
export const PAYEE_TYPES = ["PERSON", "ACCOUNT", "MOBILE_MONEY", "CARD", "BLINK", "MANUAL"] as const;
export type PayeeType = (typeof PAYEE_TYPES)[number];

export const PAYEE_TYPE_LABELS: Record<PayeeType, string> = {
  PERSON: "Person",
  ACCOUNT: "Bank account",
  MOBILE_MONEY: "Mobile money",
  CARD: "Card",
  BLINK: "Blink / Lightning",
  MANUAL: "Manual / other",
};

export type PayeeDestination = Readonly<{
  payeeType?: PayeeType;
  payeeName?: string;
  payeeReference?: string;
}>;

export function payeeReferencePlaceholder(payeeType: PayeeType | ""): string {
  switch (payeeType) {
    case "PERSON":
      return "Phone number (optional)";
    case "ACCOUNT":
      return "Bank account number";
    case "MOBILE_MONEY":
      return "Mobile money number";
    case "CARD":
      return "Card last 4 digits / reference";
    case "BLINK":
      return "Blink username / Lightning address";
    case "MANUAL":
      return "Reference / note";
    default:
      return "e.g. account number, phone number, Blink ID";
  }
}

/**
 * System posts keep one narration for the whole journal. A manual journal entry can
 * give the debit and the credit different narrations, stored on the line. Those win
 * for MANUAL_JOURNAL_ENTRY. Everywhere else the journal narration still wins, because
 * older line memos are account names.
 */
export function journalLineDescription(
  narration: string | null | undefined,
  memo: string | null | undefined,
  referenceType?: string | null,
): string {
  const header = narration?.trim() ?? "";
  const line = memo?.trim() ?? "";
  if (referenceType === "MANUAL_JOURNAL_ENTRY" && line) return line;
  if (header) return header;
  return line;
}

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
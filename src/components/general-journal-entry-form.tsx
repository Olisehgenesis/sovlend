"use client";

import { Landmark, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SearchableSelect } from "@/components/searchable-select";
import { BrandActionButton } from "@/components/ui/brand-action-button";

type LedgerAccountOption = { id: string; code: string; name: string; type: string; currencyCode: string };
type LineDraft = { key: string; accountId: string; amount: string };

function newLine(): LineDraft {
  return { key: crypto.randomUUID(), accountId: "", amount: "" };
}

function parseAmountMinor(amount: string): bigint | null {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function formatMinor(minor: bigint): string {
  const whole = minor / 100n;
  const fraction = (minor < 0n ? -minor : minor) % 100n;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

/**
 * iLend/Fineract-style "Add Journal Entries": pick any number of GL accounts to debit and any
 * number to credit, with running totals so the poster can see at a glance whether the entry
 * balances before submitting. Every account picker is a SearchableSelect (type-to-filter) since
 * a real chart of accounts can run into the hundreds of rows.
 */
export function GeneralJournalEntryForm({
  officeId,
  offices,
  currencies,
  ledgerAccounts,
}: {
  officeId: string | null;
  offices: Array<{ id: string; name: string }>;
  currencies: Array<{ code: string; name: string }>;
  ledgerAccounts: LedgerAccountOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [selectedOfficeId, setSelectedOfficeId] = useState(officeId ?? offices[0]?.id ?? "");
  const [currencyCode, setCurrencyCode] = useState(currencies[0]?.code ?? "");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);
  const [paymentType, setPaymentType] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [bankNumber, setBankNumber] = useState("");
  const [debits, setDebits] = useState<LineDraft[]>([newLine()]);
  const [credits, setCredits] = useState<LineDraft[]>([newLine()]);

  const accountsForCurrency = useMemo(() => ledgerAccounts.filter((account) => account.currencyCode === currencyCode), [ledgerAccounts, currencyCode]);
  const accountOptions = useMemo(
    () => accountsForCurrency.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}`, searchText: `${account.type} ${account.currencyCode}` })),
    [accountsForCurrency],
  );

  const totalDebitMinor = useMemo(() => debits.reduce((sum, line) => sum + (parseAmountMinor(line.amount) ?? 0n), 0n), [debits]);
  const totalCreditMinor = useMemo(() => credits.reduce((sum, line) => sum + (parseAmountMinor(line.amount) ?? 0n), 0n), [credits]);
  const differenceMinor = totalDebitMinor - totalCreditMinor;
  const balanced = differenceMinor === 0n && totalDebitMinor > 0n;

  function updateLine(side: "debit" | "credit", key: string, patch: Partial<LineDraft>) {
    const setter = side === "debit" ? setDebits : setCredits;
    setter((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  function addLine(side: "debit" | "credit") {
    (side === "debit" ? setDebits : setCredits)((lines) => [...lines, newLine()]);
  }
  function removeLine(side: "debit" | "credit", key: string) {
    (side === "debit" ? setDebits : setCredits)((lines) => (lines.length > 1 ? lines.filter((line) => line.key !== key) : lines));
  }

  async function submit() {
    if (!selectedOfficeId) return toast.error("Select an office");
    if (!currencyCode) return toast.error("Select a currency");
    if (!businessDate) return toast.error("Select a transaction date");

    const buildLines = (lines: LineDraft[], label: string) => {
      const built: Array<{ ledgerAccountId: string; amountMinor: string }> = [];
      for (const line of lines) {
        if (!line.accountId && !line.amount.trim()) continue;
        if (!line.accountId) throw new Error(`Select a GL account for every ${label} row`);
        const amountMinor = parseAmountMinor(line.amount);
        if (amountMinor === null || amountMinor <= 0n) throw new Error(`Enter a valid amount for every ${label} row`);
        built.push({ ledgerAccountId: line.accountId, amountMinor: amountMinor.toString() });
      }
      if (built.length === 0) throw new Error(`At least one ${label} entry is required`);
      return built;
    };

    let debitLines: Array<{ ledgerAccountId: string; amountMinor: string }>;
    let creditLines: Array<{ ledgerAccountId: string; amountMinor: string }>;
    try {
      debitLines = buildLines(debits, "debit");
      creditLines = buildLines(credits, "credit");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check the debit/credit rows");
      return;
    }

    const debitTotal = debitLines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const creditTotal = creditLines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    if (debitTotal !== creditTotal) {
      toast.error(`Debits (${formatMinor(debitTotal)}) must equal credits (${formatMinor(creditTotal)})`);
      return;
    }

    setPending(true);
    const response = await fetch("/api/accounting/general-journal-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId: selectedOfficeId,
        currencyCode,
        businessDate,
        referenceNumber: referenceNumber.trim() || null,
        narration: narration.trim(),
        debits: debitLines,
        credits: creditLines,
        paymentDetails: showPaymentDetails
          ? {
              paymentType: paymentType.trim() || null,
              accountNumber: accountNumber.trim() || null,
              checkNumber: checkNumber.trim() || null,
              receiptNumber: receiptNumber.trim() || null,
              bankNumber: bankNumber.trim() || null,
            }
          : null,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Journal entry could not be recorded");
      return;
    }
    toast.success("Journal entry posted");
    router.push("/reports/accounting/journal-reconciliation");
    router.refresh();
  }

  const noAccounts = accountOptions.length === 0;

  function renderSide(side: "debit" | "credit", lines: LineDraft[]) {
    return (
      <div className="journal-entry-lines">
        <div className="journal-entry-side-heading">
          <span>{side === "debit" ? "Debit" : "Credit"}</span>
        </div>
        {lines.map((line) => (
          <div className="journal-entry-line" key={line.key}>
            <SearchableSelect
              name={`${side}-account-${line.key}`}
              options={accountOptions}
              defaultValue={line.accountId}
              placeholder="Search GL account..."
              emptyMessage={noAccounts ? "No accounts enabled for manual entries in this currency" : "No matches"}
              onChange={(value) => updateLine(side, line.key, { accountId: value })}
            />
            <input
              inputMode="decimal"
              pattern="[0-9]+([.][0-9]{1,2})?"
              placeholder="Amount"
              value={line.amount}
              onChange={(event) => updateLine(side, line.key, { amount: event.target.value })}
            />
            <button type="button" className="journal-entry-remove" disabled={lines.length === 1} onClick={() => removeLine(side, line.key)} aria-label={`Remove ${side} row`}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button type="button" className="secondary-action journal-entry-add" onClick={() => addLine(side)}>
          <Plus size={14} /> Add {side} line
        </button>
      </div>
    );
  }

  return (
    <div className="entity-form compact-mapping">
      <fieldset>
        <legend>Add journal entry</legend>
        {noAccounts ? (
          <aside className="configuration-note">
            <strong>Accounting setup required</strong>
            <span>Enable &quot;Allow manual entries&quot; on at least two active detail accounts in this currency, in Chart of accounts.</span>
          </aside>
        ) : null}
        <div className="form-row">
          <label>
            Office
            <select value={selectedOfficeId} onChange={(event) => setSelectedOfficeId(event.target.value)} required>
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <select value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)} required>
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.name} ({currency.code})
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="fieldset-intro">Affected GL entries</p>
        {renderSide("debit", debits)}
        {renderSide("credit", credits)}

        <div className="journal-entry-totals">
          <div>
            <span>Total debit</span>
            <strong>{formatMinor(totalDebitMinor)}</strong>
          </div>
          <div>
            <span>Total credit</span>
            <strong>{formatMinor(totalCreditMinor)}</strong>
          </div>
          <div>
            <span>Difference</span>
            <strong className={differenceMinor === 0n ? "balanced" : "imbalanced"}>{formatMinor(differenceMinor < 0n ? -differenceMinor : differenceMinor)}</strong>
          </div>
        </div>

        <div className="form-row">
          <label>
            Reference number
            <input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} maxLength={60} placeholder="Optional" />
          </label>
          <label>
            Transaction date
            <input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} required />
          </label>
        </div>

        <label className="check-row">
          <input type="checkbox" checked={showPaymentDetails} onChange={(event) => setShowPaymentDetails(event.target.checked)} />
          Show payment details
        </label>
        {showPaymentDetails ? (
          <div className="form-row three">
            <label>
              Payment type
              <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)}>
                <option value="">Select</option>
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="MOBILE_MONEY">Mobile money</option>
                <option value="CHEQUE">Cheque</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>
              Account number
              <input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} maxLength={60} />
            </label>
            <label>
              Cheque number
              <input value={checkNumber} onChange={(event) => setCheckNumber(event.target.value)} maxLength={60} />
            </label>
            <label>
              Receipt number
              <input value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} maxLength={60} />
            </label>
            <label>
              Bank/routing number
              <input value={bankNumber} onChange={(event) => setBankNumber(event.target.value)} maxLength={60} />
            </label>
          </div>
        ) : null}

        <label>
          Comments
          <textarea value={narration} onChange={(event) => setNarration(event.target.value)} maxLength={200} rows={3} placeholder="Optional description of this entry" />
        </label>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton
          disabled={pending || noAccounts || !balanced}
          icon={pending ? <LoaderCircle className="spin" size={18} /> : <Landmark size={18} />}
          type="button"
          onClick={submit}
        >
          Post journal entry
        </BrandActionButton>
      </div>
    </div>
  );
}

"use client";

import { Landmark, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SearchableSelect } from "@/components/searchable-select";
import { BrandActionButton } from "@/components/ui/brand-action-button";

type SavingsOption = Readonly<{ id: string; accountNumber: string; productName: string; isDefault: boolean }>;
type LedgerOption = Readonly<{ id: string; code: string; name: string; type: string }>;

function parseAmountMinor(amount: string): bigint | null {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function ClientJournalForm({
  clientId,
  clientName,
  savingsAccounts,
  ledgerAccounts,
}: {
  clientId: string;
  clientName: string;
  savingsAccounts: readonly SavingsOption[];
  ledgerAccounts: readonly LedgerOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const defaultSavingsId = savingsAccounts.find((account) => account.isDefault)?.id ?? savingsAccounts[0]?.id ?? "";
  const [savingsAccountId, setSavingsAccountId] = useState(defaultSavingsId);
  const [creditAccountId, setCreditAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));

  const accountOptions = useMemo(
    () => ledgerAccounts.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}`, searchText: `${account.type} ${account.name}` })),
    [ledgerAccounts],
  );

  async function submit() {
    const amountMinor = parseAmountMinor(amount);
    if (amountMinor === null || amountMinor <= 0n) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!savingsAccountId) {
      toast.error("Select the member contribution account to debit");
      return;
    }
    if (!creditAccountId) {
      toast.error("Select the journal account to credit");
      return;
    }
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/journals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savingsAccountId,
        creditAccountId,
        amountMinor: amountMinor.toString(),
        businessDate,
        narration: narration.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Journal could not be posted");
      return;
    }
    toast.success(`Journal posted for ${clientName}`);
    setAmount("");
    setNarration("");
    router.refresh();
  }

  if (savingsAccounts.length === 0) return null;

  return (
    <div className="account-card-form">
      <fieldset>
        <legend>Post journal from member contribution</legend>
        <p className="field-help">Debits the selected savings account (usually member contribution) and credits a journal account. Search journal entries later by {clientName}.</p>
        <div className="form-row">
          <label>
            Debit savings
            <select onChange={(event) => setSavingsAccountId(event.target.value)} value={savingsAccountId}>
              {savingsAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.productName} · {account.accountNumber}{account.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input inputMode="decimal" onChange={(event) => setAmount(event.target.value)} placeholder="0.00" value={amount} />
          </label>
        </div>
        <label>
          Credit journal account
          <SearchableSelect
            name="creditAccountId"
            options={accountOptions}
            defaultValue={creditAccountId}
            placeholder="Search GL account..."
            emptyMessage="No GL accounts"
            onChange={setCreditAccountId}
          />
        </label>
        <div className="form-row">
          <label>
            Business date
            <input onChange={(event) => setBusinessDate(event.target.value)} type="date" value={businessDate} />
          </label>
          <label>
            Narration
            <input maxLength={200} onChange={(event) => setNarration(event.target.value)} placeholder="Optional" value={narration} />
          </label>
        </div>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending || !creditAccountId} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Landmark size={16} />} onClick={submit} type="button">
          Post journal
        </BrandActionButton>
      </div>
    </div>
  );
}

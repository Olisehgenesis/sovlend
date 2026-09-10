"use client";

import { Landmark, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

export function ManualJournalEntryForm({
  entryType,
  officeId,
  offices,
  ledgerAccounts,
  settlementAccounts,
}: {
  entryType: "INCOME" | "EXPENSE";
  officeId: string | null;
  offices: Array<{ id: string; name: string }>;
  ledgerAccounts: Array<{ id: string; code: string; name: string }>;
  settlementAccounts: Array<{ id: string; name: string; type: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const label = entryType === "INCOME" ? "income" : "expense";
  // Cash is the most common settlement method in practice, so it's pre-selected ahead of
  // whichever bank/mobile-money account happens to sort first -- still changeable.
  const orderedSettlementAccounts = useMemo(() => {
    const cashAccount = settlementAccounts.find((account) => account.type === "CASH");
    return cashAccount ? [cashAccount, ...settlementAccounts.filter((account) => account.id !== cashAccount.id)] : settlementAccounts;
  }, [settlementAccounts]);

  async function submit(formData: FormData) {
    setPending(true);
    const amount = String(formData.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      toast.error(`Enter a valid ${label} amount`);
      setPending(false);
      return;
    }
    const [whole, fraction = ""] = amount.split(".");
    const amountMinor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
    const response = await fetch("/api/accounting/journal-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryType,
        officeId: formData.get("officeId"),
        ledgerAccountId: formData.get("ledgerAccountId"),
        settlementAccountId: formData.get("settlementAccountId"),
        amountMinor,
        businessDate: formData.get("businessDate"),
        narration: formData.get("narration"),
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? `${label === "income" ? "Income" : "Expense"} could not be recorded`);
      return;
    }
    toast.success(`${label === "income" ? "Income" : "Expense"} recorded`);
    router.push("/reports/accounting/journal-reconciliation");
    router.refresh();
  }

  const noAccounts = ledgerAccounts.length === 0 || orderedSettlementAccounts.length === 0;

  return (
    <form action={submit} className="entity-form compact-mapping">
      <fieldset>
        <legend>Record {label}</legend>
        {noAccounts ? (
          <aside className="configuration-note">
            <strong>Accounting setup required</strong>
            <span>
              {ledgerAccounts.length === 0
                ? `Enable "Allow manual entries" on at least one ${label} account in Chart of accounts.`
                : "Add a cash, bank, or mobile-money account in Backoffice → Accounting mappings."}
            </span>
          </aside>
        ) : null}
        <label>
          {entryType === "INCOME" ? "Income account" : "Expense account"}
          <select name="ledgerAccountId" required defaultValue="">
            <option value="" disabled>
              Select an account
            </option>
            {ledgerAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} · {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount (UGX)
          <input inputMode="decimal" name="amount" pattern="[0-9]+([.][0-9]{1,2})?" required />
        </label>
        <label>
          {entryType === "INCOME" ? "Received into" : "Paid from"}
          <select name="settlementAccountId" required defaultValue={orderedSettlementAccounts[0]?.id ?? ""}>
            {orderedSettlementAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.type.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Office
            <select name="officeId" required defaultValue={officeId ?? offices[0]?.id ?? ""}>
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Business date
            <input name="businessDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </label>
        </div>
        <label>
          Description
          <input name="narration" maxLength={200} required placeholder={entryType === "INCOME" ? "e.g. Donation received" : "e.g. Office rent for September"} />
        </label>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending || noAccounts} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Landmark size={18} />} type="submit">
          Record {label}
        </BrandActionButton>
      </div>
    </form>
  );
}

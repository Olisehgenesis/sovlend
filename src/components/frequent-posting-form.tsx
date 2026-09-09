"use client";

import { LoaderCircle, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

type AccountOption = { id: string; code: string; name: string };
export type FrequentPostingRule = {
  id: string;
  name: string;
  description: string | null;
  officeId: string | null;
  debitAccounts: AccountOption[];
  creditAccounts: AccountOption[];
};

export function FrequentPostingForm({
  officeId,
  offices,
  rules,
}: {
  officeId: string | null;
  offices: Array<{ id: string; name: string }>;
  rules: FrequentPostingRule[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState(rules[0]?.id ?? "");
  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedRuleId) ?? null, [rules, selectedRuleId]);

  async function submit(formData: FormData) {
    setPending(true);
    const amount = String(formData.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      toast.error("Enter a valid amount");
      setPending(false);
      return;
    }
    const [whole, fraction = ""] = amount.split(".");
    const amountMinor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
    const response = await fetch("/api/accounting/frequent-postings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleId: formData.get("ruleId"),
        officeId: formData.get("officeId"),
        amountMinor,
        businessDate: formData.get("businessDate"),
        narration: formData.get("narration"),
        debitAccountId: formData.get("debitAccountId") || undefined,
        creditAccountId: formData.get("creditAccountId") || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Posting could not be recorded");
      return;
    }
    toast.success("Posting recorded");
    router.push("/reports/accounting/journal-reconciliation");
    router.refresh();
  }

  if (rules.length === 0) {
    return (
      <aside className="configuration-note">
        <strong>No accounting rules yet</strong>
        <span>Ask a super-admin to create one under Accounting rules before using Frequent postings.</span>
      </aside>
    );
  }

  return (
    <form action={submit} className="entity-form compact-mapping">
      <fieldset>
        <legend>Frequent posting</legend>
        <label>
          Accounting rule
          <select name="ruleId" required value={selectedRuleId} onChange={(event) => setSelectedRuleId(event.target.value)}>
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name}
              </option>
            ))}
          </select>
        </label>
        {selectedRule?.description ? <p className="field-hint">{selectedRule.description}</p> : null}
        {selectedRule && selectedRule.debitAccounts.length > 1 ? (
          <label>
            Debit account
            <select name="debitAccountId" required defaultValue="">
              <option value="" disabled>
                Select an account
              </option>
              {selectedRule.debitAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selectedRule && selectedRule.creditAccounts.length > 1 ? (
          <label>
            Credit account
            <select name="creditAccountId" required defaultValue="">
              <option value="" disabled>
                Select an account
              </option>
              {selectedRule.creditAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Amount
          <input inputMode="decimal" name="amount" pattern="[0-9]+([.][0-9]{1,2})?" required />
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
          <input name="narration" maxLength={200} required placeholder="e.g. Petty cash top-up for September" />
        </label>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Repeat size={18} />} type="submit">
          Post transaction
        </BrandActionButton>
      </div>
    </form>
  );
}

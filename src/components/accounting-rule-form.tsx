"use client";

import { ListChecks, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

type AccountOption = { id: string; code: string; name: string };
type Office = { id: string; name: string };
export type AccountingRuleSummary = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  officeId: string | null;
  debitAccountIds: string[];
  creditAccountIds: string[];
};

export function AccountingRuleForm({
  rule,
  offices,
  accounts,
  onSaved,
}: {
  rule: AccountingRuleSummary | null;
  offices: Office[];
  accounts: AccountOption[];
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function selectedIds(select: HTMLSelectElement): string[] {
    return Array.from(select.selectedOptions).map((option) => option.value);
  }

  async function submit(formData: FormData) {
    setPending(true);
    const debitSelect = document.getElementById(`debit-accounts-${rule?.id ?? "new"}`) as HTMLSelectElement;
    const creditSelect = document.getElementById(`credit-accounts-${rule?.id ?? "new"}`) as HTMLSelectElement;
    const debitAccountIds = selectedIds(debitSelect);
    const creditAccountIds = selectedIds(creditSelect);
    if (debitAccountIds.length === 0 || creditAccountIds.length === 0) {
      toast.error("Select at least one debit and one credit account");
      setPending(false);
      return;
    }

    const officeId = String(formData.get("officeId") || "");
    const response = await fetch("/api/accounting/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: rule?.id,
        officeId: officeId || null,
        name: formData.get("name"),
        description: formData.get("description") || undefined,
        active: rule ? formData.get("active") === "on" : true,
        accounts: [
          ...debitAccountIds.map((accountId) => ({ accountId, side: "DEBIT" })),
          ...creditAccountIds.map((accountId) => ({ accountId, side: "CREDIT" })),
        ],
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Accounting rule could not be saved");
      return;
    }
    toast.success(rule ? "Accounting rule updated" : "Accounting rule created");
    router.refresh();
    onSaved?.();
  }

  return (
    <form action={submit} className="entity-form compact-mapping">
      <fieldset>
        <legend>{rule ? `Edit "${rule.name}"` : "New accounting rule"}</legend>
        <label>
          Rule name
          <input name="name" required minLength={2} maxLength={100} defaultValue={rule?.name ?? ""} placeholder="e.g. Petty Cash Replenishment" />
        </label>
        <label>
          Description
          <input name="description" maxLength={300} defaultValue={rule?.description ?? ""} placeholder="e.g. Dr Office Supplies Expense, Cr Cash" />
        </label>
        <label>
          Office
          <select name="officeId" defaultValue={rule?.officeId ?? ""}>
            <option value="">All offices</option>
            {offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Debit account(s)
            <select id={`debit-accounts-${rule?.id ?? "new"}`} multiple size={5} defaultValue={rule?.debitAccountIds ?? []}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Credit account(s)
            <select id={`credit-accounts-${rule?.id ?? "new"}`} multiple size={5} defaultValue={rule?.creditAccountIds ?? []}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="field-hint">Select one account per side for a fixed rule, or multiple so the poster picks from a restricted list when using it.</p>
        {rule ? (
          <label className="checkbox-row">
            <input type="checkbox" name="active" defaultChecked={rule.active} />
            Active
          </label>
        ) : null}
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <ListChecks size={18} />} type="submit">
          {rule ? "Save rule" : "Create rule"}
        </BrandActionButton>
      </div>
    </form>
  );
}

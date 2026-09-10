"use client";

import { Landmark, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

type AccountOption = { id: string; code: string; name: string };

export function OpeningBalanceMigrationForm({
  officeId,
  offices,
  accounts,
  defaultsConfigured,
}: {
  officeId: string | null;
  offices: Array<{ id: string; name: string }>;
  accounts: AccountOption[];
  defaultsConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

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
    const response = await fetch("/api/accounting/opening-balance-migrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId: formData.get("officeId"),
        ledgerAccountId: formData.get("ledgerAccountId"),
        asOfDate: formData.get("asOfDate"),
        direction: formData.get("direction"),
        amountMinor,
        narration: formData.get("narration") || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Opening balance could not be migrated");
      return;
    }
    if (result.alreadyMigrated) {
      toast.success("This office/account already has an opening balance migrated");
    } else {
      toast.success("Opening balance migrated");
    }
    router.push("/reports/accounting/journal-reconciliation");
    router.refresh();
  }

  if (!defaultsConfigured) {
    return (
      <aside className="configuration-note">
        <strong>Opening balance equity account not configured</strong>
        <span>Set the opening balance equity account above before migrating opening balances.</span>
      </aside>
    );
  }

  return (
    <form action={submit} className="entity-form compact-mapping">
      <fieldset>
        <legend>Migrate opening balance</legend>
        <p className="field-hint">
          Sets the starting balance of a GL account at an office as of a date. Each office/account combination can only be migrated once.
        </p>
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
            GL account
            <select name="ledgerAccountId" required defaultValue="">
              <option value="" disabled>
                Select an account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Direction
            <select name="direction" required defaultValue="DEBIT">
              <option value="DEBIT">Debit (asset/expense balance)</option>
              <option value="CREDIT">Credit (liability/equity/revenue balance)</option>
            </select>
          </label>
          <label>
            Amount
            <input inputMode="decimal" name="amount" pattern="[0-9]+([.][0-9]{1,2})?" required />
          </label>
        </div>
        <label>
          As of date
          <input name="asOfDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        </label>
        <label>
          Description (optional)
          <input name="narration" maxLength={200} placeholder="e.g. Opening balance from legacy system migration" />
        </label>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Landmark size={18} />} type="submit">
          Migrate opening balance
        </BrandActionButton>
      </div>
    </form>
  );
}

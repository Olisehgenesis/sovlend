"use client";

import { LoaderCircle, Save, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type LedgerAccountOption = Readonly<{ id: string; label: string }>;
type FundRecord = Readonly<{
  id: string;
  name: string;
  code: string | null;
  ledgerAccountId: string | null;
  isActive: boolean;
  ledgerAccount: Readonly<{ id: string; code: string; name: string; type: string; currencyCode: string }> | null;
}>;

function nullableString(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  return value ? value : undefined;
}

export function FundManagementForm({
  organizationId,
  funds,
  ledgerAccounts,
}: {
  organizationId: string;
  funds: readonly FundRecord[];
  ledgerAccounts: readonly LedgerAccountOption[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [savingFundId, setSavingFundId] = useState<string | null>(null);

  async function createFund(formData: FormData) {
    setCreating(true);
    const response = await fetch("/api/backoffice/funds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        name: formData.get("name"),
        code: nullableString(formData, "code"),
        ledgerAccountId: nullableString(formData, "ledgerAccountId"),
        isActive: formData.get("isActive") === "on",
      }),
    });
    const result = await response.json().catch(() => ({}));
    setCreating(false);
    if (!response.ok) {
      toast.error(result.error ?? "Fund could not be created");
      return;
    }
    toast.success("Fund created");
    router.refresh();
  }

  async function updateFund(id: string, formData: FormData) {
    setSavingFundId(id);
    const response = await fetch(`/api/backoffice/funds/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        code: nullableString(formData, "code"),
        ledgerAccountId: nullableString(formData, "ledgerAccountId"),
        isActive: formData.get("isActive") === "on",
      }),
    });
    const result = await response.json().catch(() => ({}));
    setSavingFundId(null);
    if (!response.ok) {
      toast.error(result.error ?? "Fund could not be updated");
      return;
    }
    toast.success("Fund updated");
    router.refresh();
  }

  return (
    <div className="settlement-manager">
      <div className="panel-heading">
        <div>
          <h2>Funds</h2>
          <p>{funds.length} fund{funds.length === 1 ? "" : "s"} available for loan tagging and portfolio reporting</p>
        </div>
      </div>
      {funds.length === 0 ? (
        <div className="empty-state compact-empty">
          <Wallet size={26} />
          <strong>No funds configured</strong>
          <p>Add the first funding pool before tagging new loan applications.</p>
        </div>
      ) : (
        <div className="settlement-registry">
          {funds.map((fund) => (
            <details className="mapping-product" key={fund.id}>
              <summary>
                <span>
                  <strong>{fund.name}</strong>
                  <small>
                    {fund.code ? `${fund.code} · ` : ""}
                    {fund.ledgerAccount ? `${fund.ledgerAccount.code} · ${fund.ledgerAccount.name}` : "Reporting only"}
                  </small>
                </span>
                <span className={`mapping-state ${fund.isActive ? "ready" : "missing"}`}>{fund.isActive ? "Active" : "Inactive"}</span>
              </summary>
              <form
                action={(formData) => updateFund(fund.id, formData)}
                className="entity-form compact-mapping"
              >
                <div className="form-row">
                  <label>
                    Fund name
                    <input defaultValue={fund.name} name="name" required />
                  </label>
                  <label>
                    Code
                    <input defaultValue={fund.code ?? ""} name="code" placeholder="Optional short code" />
                  </label>
                </div>
                <label>
                  Linked ledger account
                  <select defaultValue={fund.ledgerAccountId ?? ""} name="ledgerAccountId">
                    <option value="">Reporting only (no ledger account)</option>
                    {ledgerAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.label}
                      </option>
                    ))}
                  </select>
                  <small className="field-help">Leave blank to use this fund as a pure reporting tag.</small>
                </label>
                <label>
                  <input defaultChecked={fund.isActive} name="isActive" type="checkbox" /> Active fund
                </label>
                <div className="form-actions">
                  <button className="invest-button" disabled={savingFundId === fund.id} type="submit">
                    {savingFundId === fund.id ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Save changes
                  </button>
                </div>
              </form>
            </details>
          ))}
        </div>
      )}
      <form action={createFund} className="entity-form compact-mapping settlement-create">
        <fieldset>
          <legend>Add fund</legend>
          <p className="fieldset-intro">Funds can stay as reporting tags or optionally point at a real detail ledger account for later capital tracking.</p>
          <div className="form-row">
            <label>
              Fund name
              <input name="name" placeholder="JSA Own Fund" required />
            </label>
            <label>
              Code
              <input name="code" placeholder="Optional short code" />
            </label>
          </div>
          <label>
            Linked ledger account
            <select defaultValue="" name="ledgerAccountId">
              <option value="">Reporting only (no ledger account)</option>
              {ledgerAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input defaultChecked name="isActive" type="checkbox" /> Active fund
          </label>
        </fieldset>
        <div className="form-actions">
          <button className="invest-button" disabled={creating} type="submit">
            {creating ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Add fund
          </button>
        </div>
      </form>
    </div>
  );
}

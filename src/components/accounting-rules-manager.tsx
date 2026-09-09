"use client";

import { useState } from "react";

import { AccountingRuleForm, type AccountingRuleSummary } from "@/components/accounting-rule-form";

type AccountOption = { id: string; code: string; name: string };
type Office = { id: string; name: string };

export function AccountingRulesManager({
  rules,
  offices,
  accounts,
}: {
  rules: AccountingRuleSummary[];
  offices: Office[];
  accounts: AccountOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const accountLabel = (id: string) => {
    const account = accounts.find((candidate) => candidate.id === id);
    return account ? `${account.code} · ${account.name}` : id;
  };

  return (
    <div className="accounting-rules-manager">
      <article className="panel">
        <AccountingRuleForm rule={null} offices={offices} accounts={accounts} />
      </article>
      {rules.length === 0 ? (
        <p className="empty-state">No accounting rules yet. Create one above to use it in Frequent postings.</p>
      ) : (
        <ul className="entity-list">
          {rules.map((rule) =>
            editingId === rule.id ? (
              <li key={rule.id} className="panel">
                <AccountingRuleForm rule={rule} offices={offices} accounts={accounts} onSaved={() => setEditingId(null)} />
                <button type="button" className="secondary-action" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </li>
            ) : (
              <li key={rule.id} className="entity-row">
                <div>
                  <strong>{rule.name}</strong>
                  {rule.active ? null : <span className="mapping-state missing">Inactive</span>}
                  <p>{rule.description}</p>
                  <p className="field-hint">
                    Dr {rule.debitAccountIds.map(accountLabel).join(", ")} · Cr {rule.creditAccountIds.map(accountLabel).join(", ")}
                  </p>
                </div>
                <button type="button" className="secondary-action" onClick={() => setEditingId(rule.id)}>
                  Edit
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

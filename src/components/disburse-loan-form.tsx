"use client";

import { Banknote, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function DisburseLoanForm({ loanId, settlementAccounts }: { loanId: string; settlementAccounts: Array<{ id: string; name: string; type: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function disburse(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/disburse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settlementAccountId: formData.get("settlementAccountId"), businessDate: formData.get("businessDate"), externalReference: formData.get("externalReference") || undefined, idempotencyKey: crypto.randomUUID() }) });
    const result = await response.json(); setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Loan could not be disbursed"); return; }
    toast.success("Loan disbursed and repayment schedule created"); router.refresh();
  }
  return <form action={disburse} className="entity-form approval-form"><fieldset><legend>Disbursement</legend>{settlementAccounts.length === 0 ? <aside className="configuration-note"><strong>Settlement setup required</strong><span>Add a cash drawer, bank account, Airtel Money, MTN MoMo, or another account in Backoffice → Accounting mappings.</span></aside> : <label>Settlement account<select name="settlementAccountId" required>{settlementAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type.replaceAll("_", " ")}</option>)}</select></label>}<label>Business date<input name="businessDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>Receipt / external reference<input name="externalReference" /></label></fieldset><div className="form-actions"><button className="invest-button" disabled={pending || settlementAccounts.length === 0}>{pending ? <LoaderCircle className="spin" size={18} /> : <Banknote size={18} />} Disburse loan</button></div></form>;
}
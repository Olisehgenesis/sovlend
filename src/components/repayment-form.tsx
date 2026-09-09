"use client";

import { Banknote, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

function minorToAmountString(amountMinor: string): string {
  const value = BigInt(amountMinor || "0");
  if (value <= 0n) return "";
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return fraction === "00" ? whole.toString() : `${whole}.${fraction}`;
}

export function RepaymentForm({ loanId, settlementAccounts, defaultAmountMinor, onSuccess }: { loanId: string; settlementAccounts: Array<{ id: string; name: string; type: string }>; defaultAmountMinor?: string; onSuccess?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const defaultAmount = minorToAmountString(defaultAmountMinor ?? "0");
  async function repay(formData: FormData) {
    setPending(true);
    const amount = String(formData.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) { toast.error("Enter a valid repayment amount"); setPending(false); return; }
    const [whole, fraction = ""] = amount.split(".");
    const amountMinor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
    const response = await fetch(`/api/loans/${loanId}/repayments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountMinor, settlementAccountId: formData.get("settlementAccountId"), businessDate: formData.get("businessDate"), externalReference: formData.get("externalReference") || undefined, idempotencyKey: crypto.randomUUID() }) });
    const result = await response.json(); setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Repayment could not be recorded"); return; }
    toast.success("Repayment recorded and allocated"); router.refresh(); onSuccess?.();
  }
  return <form action={repay} className="entity-form compact-mapping"><fieldset><legend>Record repayment</legend><label>Amount (UGX)<input defaultValue={defaultAmount || undefined} inputMode="decimal" name="amount" pattern="[0-9]+([.][0-9]{1,2})?" required /></label>{defaultAmount ? <p className="field-help">Defaults to the next installment due &mdash; change it if the borrower is paying a different amount.</p> : null}{settlementAccounts.length === 0 ? <aside className="configuration-note"><strong>Settlement setup required</strong><span>Add the receiving cash, bank, Airtel Money, MTN MoMo, or other account in Backoffice → Accounting mappings.</span></aside> : <label>Received into<select name="settlementAccountId" required>{settlementAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type.replaceAll("_", " ")}</option>)}</select></label>}<div className="form-row"><label>Business date<input name="businessDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>Receipt / reference<input name="externalReference" /></label></div></fieldset><div className="form-actions"><BrandActionButton disabled={pending || settlementAccounts.length === 0} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Banknote size={18} />} type="submit">Record repayment</BrandActionButton></div></form>;
}
"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function ApproveLoanForm({ applicationId, proposedAmount }: { applicationId: string; proposedAmount: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function approve(formData: FormData) {
    setPending(true);
    const amount = String(formData.get("amount"));
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      toast.error("Enter a valid approved amount");
      setPending(false);
      return;
    }
    const [whole, fraction = ""] = amount.split(".");
    const approvedPrincipalMinor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
    const response = await fetch(`/api/loan-applications/${applicationId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvedPrincipalMinor, reason: formData.get("reason") || undefined }) });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Application could not be approved");
      return;
    }
    toast.success("Loan application approved");
    router.refresh();
  }

  return <form action={approve} className="entity-form approval-form"><fieldset><legend>Checker decision</legend><label>Approved principal (UGX)<input name="amount" defaultValue={proposedAmount} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required /></label><label>Approval note<textarea name="reason" rows={3} /></label></fieldset><div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />} Approve application</button></div></form>;
}
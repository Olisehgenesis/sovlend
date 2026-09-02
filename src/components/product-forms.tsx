"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function CreateSavingsProductForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/backoffice/savings-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        shortName: formData.get("shortName"),
        description: formData.get("description") || undefined,
        nominalAnnualRate: formData.get("nominalAnnualRate") || 0,
        minOpeningBalance: formData.get("minOpeningBalance") || 0,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not create savings product"); return; }
    toast.success("Savings product created");
    router.refresh();
  }

  return <form action={submit} className="entity-form compact-mapping">
    <fieldset><legend>New savings product</legend><div className="form-row three"><label>Name<input name="name" placeholder="Regular savings" required /></label><label>Short name<input maxLength={20} name="shortName" placeholder="RS" required /></label><label>Annual rate %<input min={0} name="nominalAnnualRate" step="0.01" type="number" /></label></div><div className="form-row"><label>Description<input name="description" /></label><label>Minimum opening balance (UGX)<input min={0} name="minOpeningBalance" step="0.01" type="number" /></label></div></fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Create product</button></div>
  </form>;
}

export function CreateChargeDefinitionForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [calculationType, setCalculationType] = useState<"FLAT" | "PERCENTAGE">("FLAT");

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/backoffice/charge-definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        appliesTo: formData.get("appliesTo"),
        calculationType,
        amount: calculationType === "FLAT" ? formData.get("amount") : undefined,
        percentage: calculationType === "PERCENTAGE" ? formData.get("percentage") : undefined,
        penalty: formData.get("penalty") === "on",
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not create charge"); return; }
    toast.success("Charge definition created");
    router.refresh();
  }

  return <form action={submit} className="entity-form compact-mapping">
    <fieldset><legend>New charge definition</legend><div className="form-row three"><label>Name<input name="name" placeholder="Processing fee" required /></label><label>Applies to<select name="appliesTo"><option value="LOAN">Loan</option><option value="SAVINGS">Savings</option></select></label><label>Calculation<select name="calculationType" onChange={(event) => setCalculationType(event.target.value as "FLAT" | "PERCENTAGE")} value={calculationType}><option value="FLAT">Flat amount</option><option value="PERCENTAGE">Percentage</option></select></label></div><div className="form-row"><label>{calculationType === "FLAT" ? "Amount (UGX)" : "Percentage %"}{calculationType === "FLAT" ? <input min={0} name="amount" step="0.01" type="number" /> : <input max={100} min={0} name="percentage" step="0.01" type="number" />}</label><label className="check-row"><input name="penalty" type="checkbox" /> This is a penalty</label></div></fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Create charge</button></div>
  </form>;
}

"use client";

import { LoaderCircle, Plus, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

type LoanProductDraft = Readonly<{
  id: string;
  name: string;
  shortName: string;
  denominationCurrency: string;
  principalMin: string;
  principalMax: string;
  annualRate: string;
  monitoringFeeAnnualRate: string;
  repaymentCount: number;
  repaymentFrequency: string;
  amortizationMethod: string;
  interestMethod: "Flat" | "Declining Balance";
}>;

type SavingsProductDraft = Readonly<{
  id: string;
  name: string;
  shortName: string;
  description: string;
  currencyCode: string;
  nominalAnnualRate: string;
  minOpeningBalance: string;
}>;

type ChargeDefinitionDraft = Readonly<{
  id: string;
  name: string;
  appliesTo: "LOAN" | "SAVINGS";
  calculationType: "FLAT" | "PERCENTAGE";
  amount: string;
  percentage: string;
  currencyCode: string;
  penalty: boolean;
}>;

const interestMethodOptions = ["Flat", "Declining Balance"] as const;
const appliesToOptions = [
  { value: "LOAN", label: "Loan" },
  { value: "SAVINGS", label: "Savings" },
] as const;

export function CreateLoanProductForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/backoffice/loan-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        shortName: formData.get("shortName"),
        denominationCurrency: formData.get("denominationCurrency") || "UGX",
        principalMin: formData.get("principalMin") || 0,
        principalMax: formData.get("principalMax") || 0,
        annualRate: formData.get("annualRate") || 0,
        monitoringFeeAnnualRate: formData.get("monitoringFeeAnnualRate") || 0,
        repaymentCount: formData.get("repaymentCount") || 1,
        repaymentFrequency: formData.get("repaymentFrequency"),
        amortizationMethod: formData.get("amortizationMethod"),
        interestMethod: formData.get("interestMethod"),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not create loan product");
      return;
    }
    toast.success("Loan product created");
    router.refresh();
  }

  return <form action={submit} className="entity-form compact-mapping">
    <fieldset>
      <legend>New loan product</legend>
      <div className="form-row three">
        <label>Name<input name="name" placeholder="Working capital" required /></label>
        <label>Short name<input maxLength={20} name="shortName" placeholder="WC" required /></label>
        <label>Currency code<input defaultValue="UGX" maxLength={10} name="denominationCurrency" required /></label>
      </div>
      <div className="form-row three">
        <label>Minimum principal<input inputMode="decimal" min={0} name="principalMin" required step="0.01" type="number" /></label>
        <label>Maximum principal<input inputMode="decimal" min={0} name="principalMax" required step="0.01" type="number" /></label>
        <label>Annual rate %<input min={0} name="annualRate" required step="0.01" type="number" /></label>
      </div>
      <div className="form-row">
        <label>Monitoring fee %<input min={0} name="monitoringFeeAnnualRate" step="0.01" type="number" /></label>
      </div>
      <div className="form-row three">
        <label>Repayment count<input min={1} name="repaymentCount" required step={1} type="number" /></label>
        <label>Repayment frequency<input name="repaymentFrequency" pattern="[0-9]+\s+(Day|Days|Week|Weeks|Month|Months)" placeholder="1 Months" required title="Use a number plus Day(s), Week(s), or Month(s)" /></label>
        <label>Interest method<select defaultValue="Flat" name="interestMethod">{interestMethodOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      </div>
      <div className="form-row">
        <label>Amortization method<input defaultValue="Equal installments" name="amortizationMethod" required /></label>
      </div>
    </fieldset>
    <div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">Create loan product</BrandActionButton></div>
  </form>;
}

export function EditLoanProductForm({ product }: { product: LoanProductDraft }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function save(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/backoffice/loan-products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        shortName: formData.get("shortName"),
        denominationCurrency: formData.get("denominationCurrency") || "UGX",
        principalMin: formData.get("principalMin") || 0,
        principalMax: formData.get("principalMax") || 0,
        annualRate: formData.get("annualRate") || 0,
        monitoringFeeAnnualRate: formData.get("monitoringFeeAnnualRate") || 0,
        repaymentCount: formData.get("repaymentCount") || 1,
        repaymentFrequency: formData.get("repaymentFrequency"),
        amortizationMethod: formData.get("amortizationMethod"),
        interestMethod: formData.get("interestMethod"),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Loan product could not be updated");
      return;
    }
    toast.success("Loan product updated");
    router.refresh();
  }

  return <form action={save} className="entity-form">
    <fieldset>
      <legend>Terms</legend>
      <div className="form-row three">
        <label>Name<input defaultValue={product.name} name="name" required /></label>
        <label>Short name<input defaultValue={product.shortName} maxLength={20} name="shortName" required /></label>
        <label>Currency code<input defaultValue={product.denominationCurrency} maxLength={10} name="denominationCurrency" required /></label>
      </div>
      <div className="form-row three">
        <label>Minimum principal<input defaultValue={product.principalMin} inputMode="decimal" min={0} name="principalMin" required step="0.01" type="number" /></label>
        <label>Maximum principal<input defaultValue={product.principalMax} inputMode="decimal" min={0} name="principalMax" required step="0.01" type="number" /></label>
        <label>Annual rate %<input defaultValue={product.annualRate} min={0} name="annualRate" required step="0.01" type="number" /></label>
      </div>
      <div className="form-row">
        <label>Monitoring fee %<input defaultValue={product.monitoringFeeAnnualRate} min={0} name="monitoringFeeAnnualRate" step="0.01" type="number" /></label>
      </div>
      <div className="form-row three">
        <label>Repayment count<input defaultValue={product.repaymentCount} min={1} name="repaymentCount" required step={1} type="number" /></label>
        <label>Repayment frequency<input defaultValue={product.repaymentFrequency} name="repaymentFrequency" pattern="[0-9]+\s+(Day|Days|Week|Weeks|Month|Months)" placeholder="1 Months" required title="Use a number plus Day(s), Week(s), or Month(s)" /></label>
        <label>Interest method<select defaultValue={product.interestMethod} name="interestMethod">{interestMethodOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      </div>
      <div className="form-row">
        <label>Amortization method<input defaultValue={product.amortizationMethod} name="amortizationMethod" required /></label>
      </div>
    </fieldset>
    <div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />} type="submit">Save changes</BrandActionButton></div>
  </form>;
}

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
    <div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">Create product</BrandActionButton></div>
  </form>;
}

export function EditSavingsProductForm({ product }: { product: SavingsProductDraft }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function save(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/backoffice/savings-products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        shortName: formData.get("shortName"),
        description: formData.get("description") || undefined,
        currencyCode: formData.get("currencyCode") || "UGX",
        nominalAnnualRate: formData.get("nominalAnnualRate") || 0,
        minOpeningBalance: formData.get("minOpeningBalance") || 0,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Savings product could not be updated");
      return;
    }
    toast.success("Savings product updated");
    router.refresh();
  }

  return <form action={save} className="entity-form">
    <fieldset>
      <legend>Product details</legend>
      <div className="form-row three">
        <label>Name<input defaultValue={product.name} name="name" required /></label>
        <label>Short name<input defaultValue={product.shortName} maxLength={20} name="shortName" required /></label>
        <label>Currency code<input defaultValue={product.currencyCode} maxLength={10} name="currencyCode" required /></label>
      </div>
      <div className="form-row">
        <label>Description<input defaultValue={product.description} name="description" /></label>
        <label>Annual rate %<input defaultValue={product.nominalAnnualRate} min={0} name="nominalAnnualRate" step="0.01" type="number" /></label>
        <label>Minimum opening balance<input defaultValue={product.minOpeningBalance} inputMode="decimal" min={0} name="minOpeningBalance" step="0.01" type="number" /></label>
      </div>
    </fieldset>
    <div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />} type="submit">Save changes</BrandActionButton></div>
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
    <fieldset><legend>New charge definition</legend><div className="form-row three"><label>Name<input name="name" placeholder="Processing fee" required /></label><label>Applies to<select name="appliesTo">{appliesToOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Calculation<select name="calculationType" onChange={(event) => setCalculationType(event.target.value as "FLAT" | "PERCENTAGE")} value={calculationType}><option value="FLAT">Flat amount</option><option value="PERCENTAGE">Percentage</option></select></label></div><div className="form-row"><label>{calculationType === "FLAT" ? "Amount (UGX)" : "Percentage %"}{calculationType === "FLAT" ? <input min={0} name="amount" step="0.01" type="number" /> : <input max={100} min={0} name="percentage" step="0.01" type="number" />}</label><label className="check-row"><input name="penalty" type="checkbox" /> This is a penalty</label></div></fieldset>
    <div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">Create charge</BrandActionButton></div>
  </form>;
}

export function EditChargeDefinitionForm({ charge }: { charge: ChargeDefinitionDraft }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [calculationType, setCalculationType] = useState<"FLAT" | "PERCENTAGE">(charge.calculationType);

  async function save(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/backoffice/charge-definitions/${charge.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        appliesTo: formData.get("appliesTo"),
        calculationType,
        amount: calculationType === "FLAT" ? formData.get("amount") : undefined,
        percentage: calculationType === "PERCENTAGE" ? formData.get("percentage") : undefined,
        currencyCode: formData.get("currencyCode") || "UGX",
        penalty: formData.get("penalty") === "on",
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Charge definition could not be updated");
      return;
    }
    toast.success("Charge definition updated");
    router.refresh();
  }

  return <form action={save} className="entity-form">
    <fieldset>
      <legend>Charge details</legend>
      <div className="form-row three">
        <label>Name<input defaultValue={charge.name} name="name" required /></label>
        <label>Applies to<select defaultValue={charge.appliesTo} name="appliesTo">{appliesToOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Calculation<select name="calculationType" onChange={(event) => setCalculationType(event.target.value as "FLAT" | "PERCENTAGE")} value={calculationType}><option value="FLAT">Flat amount</option><option value="PERCENTAGE">Percentage</option></select></label>
      </div>
      <div className="form-row three">
        <label>{calculationType === "FLAT" ? "Amount" : "Percentage %"}{calculationType === "FLAT" ? <input defaultValue={charge.amount} inputMode="decimal" min={0} name="amount" step="0.01" type="number" /> : <input defaultValue={charge.percentage} max={100} min={0} name="percentage" step="0.01" type="number" />}</label>
        <label>Currency code<input defaultValue={charge.currencyCode} maxLength={10} name="currencyCode" required /></label>
        <label className="check-row"><input defaultChecked={charge.penalty} name="penalty" type="checkbox" /> This is a penalty</label>
      </div>
    </fieldset>
    <div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />} type="submit">Save changes</BrandActionButton></div>
  </form>;
}

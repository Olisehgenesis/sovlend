"use client";

import { Check, ChevronLeft, ChevronRight, LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { formatMinor } from "@/modules/money/domain/format-minor";

type SavingsProductOption = Readonly<{ id: string; name: string; shortName: string; currencyCode: string; nominalAnnualRateBps: number; minOpeningBalanceMinor: string }>;
type OfficerOption = Readonly<{ id: string; name: string }>;
type ChargeOption = Readonly<{ id: string; name: string; calculationType: string; amountMinor: string | null; percentageBps: number | null; currencyCode: string }>;

const steps = ["Details", "Terms", "Charges", "Review"] as const;

export function NewSavingsAccountWizard({ clientId, products, officers, charges }: { clientId: string; products: readonly SavingsProductOption[]; officers: readonly OfficerOption[]; charges: readonly ChargeOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [productId, setProductId] = useState("");
  const [submittedOn, setSubmittedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [fieldOfficerId, setFieldOfficerId] = useState("");
  const [externalId, setExternalId] = useState("");
  const [selectedCharges, setSelectedCharges] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  const product = useMemo(() => products.find((item) => item.id === productId) ?? null, [products, productId]);

  function toggleCharge(id: string) {
    setSelectedCharges((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/savings-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountType: "SAVINGS",
        productId: productId || undefined,
        submittedOn,
        fieldOfficerId: fieldOfficerId || undefined,
        externalId: externalId || undefined,
        chargeDefinitionIds: [...selectedCharges],
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not open account"); return; }
    toast.success("Savings account requested \u2014 awaiting approval");
    setOpen(false);
    setStep(0);
    router.refresh();
  }

  if (!open) {
    return <button className="invest-button" onClick={() => setOpen(true)} type="button"><Plus size={16} /> Open savings account</button>;
  }

  return (
    <div className="savings-wizard">
      <nav className="savings-wizard-steps" aria-label="Savings application steps">
        {steps.map((label, index) => (
          <span className={index === step ? "active" : index < step ? "done" : ""} key={label}>{index < step ? <Check size={12} /> : index + 1}. {label}</span>
        ))}
      </nav>

      {step === 0 ? (
        <div className="savings-wizard-body">
          <label>Product *<select onChange={(event) => setProductId(event.target.value)} required value={productId}><option value="">Select savings product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="form-row">
            <label>Submitted on<input onChange={(event) => setSubmittedOn(event.target.value)} type="date" value={submittedOn} /></label>
            <label>Field officer<select onChange={(event) => setFieldOfficerId(event.target.value)} value={fieldOfficerId}><option value="">Unassigned</option>{officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.name}</option>)}</select></label>
          </div>
          <label>External ID<input onChange={(event) => setExternalId(event.target.value)} value={externalId} /></label>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="savings-wizard-body">
          {product ? (
            <dl className="detail-grid">
              <div><dt>Currency</dt><dd>{product.currencyCode}</dd></div>
              <div><dt>Nominal annual interest</dt><dd>{(product.nominalAnnualRateBps / 100).toFixed(2)}%</dd></div>
              <div><dt>Minimum opening balance</dt><dd>{formatMinor(BigInt(product.minOpeningBalanceMinor), product.currencyCode)}</dd></div>
            </dl>
          ) : <p className="muted-text">Choose a product on the Details step to see its terms.</p>}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="savings-wizard-body">
          {charges.length === 0 ? <p className="muted-text">No savings charges configured yet.</p> : <div className="check-list">{charges.map((charge) => <label className="check-row" key={charge.id}><input checked={selectedCharges.has(charge.id)} onChange={() => toggleCharge(charge.id)} type="checkbox" />{charge.name}{charge.calculationType === "FLAT" ? ` \u00b7 ${formatMinor(BigInt(charge.amountMinor ?? "0"), charge.currencyCode)}` : ` \u00b7 ${((charge.percentageBps ?? 0) / 100).toFixed(2)}%`}</label>)}</div>}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="savings-wizard-body">
          <dl className="detail-grid">
            <div><dt>Product</dt><dd>{product?.name ?? "Not selected"}</dd></div>
            <div><dt>Submitted on</dt><dd>{submittedOn}</dd></div>
            <div><dt>Field officer</dt><dd>{officers.find((officer) => officer.id === fieldOfficerId)?.name ?? "Unassigned"}</dd></div>
            <div><dt>External ID</dt><dd>{externalId || "\u2014"}</dd></div>
            <div><dt>Charges</dt><dd>{selectedCharges.size === 0 ? "None" : charges.filter((charge) => selectedCharges.has(charge.id)).map((charge) => charge.name).join(", ")}</dd></div>
          </dl>
        </div>
      ) : null}

      <div className="savings-wizard-actions">
        <button className="secondary-action" onClick={() => (step === 0 ? setOpen(false) : setStep((current) => current - 1))} type="button">{step === 0 ? "Cancel" : <><ChevronLeft size={15} /> Back</>}</button>
        {step < steps.length - 1 ? <button className="invest-button" disabled={step === 0 && !productId} onClick={() => setStep((current) => current + 1)} type="button">Next <ChevronRight size={15} /></button> : <button className="invest-button" disabled={pending} onClick={submit} type="button">{pending ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Submit</button>}
      </div>
    </div>
  );
}

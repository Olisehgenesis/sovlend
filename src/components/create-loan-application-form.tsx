"use client";

import { CircleDollarSign, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  buildChargePayload,
  buildCollateralPayload,
  buildTermsPayload,
  type ChargeOption,
  type CollateralDraft,
  type FundOption,
  type OfficerOption,
  type ProductOption,
  toMinor,
} from "@/components/loan-application-form-shared";
import { formatMinor } from "@/modules/money/domain/format-minor";

type ClientOption = Readonly<{ id: string; name: string; accountNumber: string }>;
type GroupOption = Readonly<{ id: string; name: string; accountNumber: string }>;

const steps = ["Details", "Terms", "Charges", "Review"] as const;

function normalizeInterestMethod(value: string | null | undefined) {
  if (value === "DECLINING_BALANCE") return "Declining Balance";
  if (value === "FLAT") return "Flat";
  return value ?? "";
}

export function CreateLoanApplicationForm({
  clients,
  groups,
  products,
  officers,
  funds,
  charges,
  selectedClientId,
  selectedGroupId,
}: {
  clients: readonly ClientOption[];
  groups?: readonly GroupOption[];
  products: readonly ProductOption[];
  officers: readonly OfficerOption[];
  funds: readonly FundOption[];
  charges: readonly ChargeOption[];
  selectedClientId?: string;
  selectedGroupId?: string;
}) {
  const router = useRouter();
  const hasGroups = (groups?.length ?? 0) > 0;
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);

  const [borrowerType, setBorrowerType] = useState<"client" | "group">(selectedGroupId ? "group" : "client");
  const [clientId, setClientId] = useState(selectedClientId ?? "");
  const [groupId, setGroupId] = useState(selectedGroupId ?? "");
  const [productId, setProductId] = useState("");
  const [loanOfficerId, setLoanOfficerId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fundId, setFundId] = useState("");
  const [externalId, setExternalId] = useState("");
  const [applicationExpiresOn, setApplicationExpiresOn] = useState("");

  const product = useMemo(() => products.find((item) => item.id === productId) ?? null, [products, productId]);

  const [amount, setAmount] = useState("");
  const [annualRatePercent, setAnnualRatePercent] = useState("");
  const [monitoringFeeAnnualRatePercent, setMonitoringFeeAnnualRatePercent] = useState("");
  const [repaymentCount, setRepaymentCount] = useState("");
  const [repaymentFrequency, setRepaymentFrequency] = useState("");
  const [interestMethod, setInterestMethod] = useState("");
  const [amortizationMethod, setAmortizationMethod] = useState("");
  const [firstRepaymentOn, setFirstRepaymentOn] = useState("");
  const [arrearsTolerance, setArrearsTolerance] = useState("");
  const [termsTouched, setTermsTouched] = useState(false);

  const [selectedCharges, setSelectedCharges] = useState<Set<string>>(new Set());
  const [collateral, setCollateral] = useState<CollateralDraft[]>([]);

  function selectProduct(id: string) {
    setProductId(id);
    const next = products.find((item) => item.id === id);
    setTermsTouched(false);
    if (!next) {
      setAnnualRatePercent("");
      setMonitoringFeeAnnualRatePercent("");
      setRepaymentCount("");
      setRepaymentFrequency("");
      setInterestMethod("");
      setAmortizationMethod("");
      setFirstRepaymentOn("");
      setArrearsTolerance("");
      return;
    }
    setAnnualRatePercent(String(next.annualRatePercent));
    setMonitoringFeeAnnualRatePercent(String(next.monitoringFeeAnnualRatePercent));
    setRepaymentCount(String(next.repaymentCount));
    setRepaymentFrequency(next.repaymentFrequency ?? "");
    setInterestMethod(normalizeInterestMethod(next.interestMethod));
    setAmortizationMethod(next.amortizationMethod ?? "");
    setFirstRepaymentOn("");
    setArrearsTolerance("");
  }

  function markTermsTouched() {
    setTermsTouched(true);
  }

  function toggleCharge(id: string) {
    setSelectedCharges((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addCollateralRow() {
    setCollateral((current) => [...current, { type: "", description: "", estimatedValue: "" }]);
  }

  function updateCollateralRow(index: number, patch: Partial<CollateralDraft>) {
    setCollateral((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  function removeCollateralRow(index: number) {
    setCollateral((current) => current.filter((_, position) => position !== index));
  }

  function detailsValid() {
    const ownerOk = borrowerType === "group" ? Boolean(groupId) : Boolean(clientId);
    return ownerOk && Boolean(productId);
  }

  function termsValid() {
    const minorAmount = toMinor(amount);
    if (minorAmount === null) return false;
    if (!product) return true;
    const value = BigInt(minorAmount);
    return value >= BigInt(product.minimumMinor) && value <= BigInt(product.maximumMinor);
  }

  function canGoTo(target: number) {
    if (target <= step) return true;
    if (target >= 1 && !detailsValid()) return false;
    if (target >= 2 && !termsValid()) return false;
    return true;
  }

  async function submit() {
    const proposedPrincipalMinor = toMinor(amount);
    if (!proposedPrincipalMinor) {
      toast.error("Enter a valid loan amount");
      return;
    }
    if (product && (BigInt(proposedPrincipalMinor) < BigInt(product.minimumMinor) || BigInt(proposedPrincipalMinor) > BigInt(product.maximumMinor))) {
      toast.error(`Principal must be between ${product.currency} ${product.minimum} and ${product.maximum}`);
      return;
    }
    setPending(true);
    const chargePayload = buildChargePayload({ charges, proposedPrincipalMinor, selectedChargeIds: selectedCharges });
    const collateralPayload = buildCollateralPayload(collateral);
    const terms = termsTouched
      ? buildTermsPayload({
          annualRatePercent,
          monitoringFeeAnnualRatePercent,
          repaymentCount,
          repaymentFrequency,
          interestMethod,
          amortizationMethod,
          firstRepaymentOn,
          arrearsTolerance,
        })
      : undefined;
    const owner = borrowerType === "group" ? { groupId } : { clientId };
    const response = await fetch("/api/loan-applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...owner,
        productId,
        loanOfficerId: loanOfficerId || undefined,
        fundId: fundId || undefined,
        proposedPrincipalMinor,
        purpose: purpose.trim() || undefined,
        externalId: externalId.trim() || undefined,
        applicationExpiresOn: applicationExpiresOn || undefined,
        terms,
        charges: chargePayload,
        collateral: collateralPayload,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Loan application could not be created");
      return;
    }
    toast.success("Loan application submitted for approval");
    router.push(`/loans/applications/${result.id}`);
    router.refresh();
  }

  const selectedClientLabel = clients.find((client) => client.id === clientId);
  const selectedGroupLabel = groups?.find((group) => group.id === groupId);
  const selectedOfficerLabel = officers.find((officer) => officer.id === loanOfficerId);
  const selectedFundLabel = funds.find((fund) => fund.id === fundId);

  return (
    <div className="entity-form">
      <nav aria-label="Loan application steps" className="client-tabs">
        {steps.map((label, index) => (
          <a
            className={index === step ? "active" : ""}
            href="#"
            key={label}
            onClick={(event) => {
              event.preventDefault();
              if (canGoTo(index)) setStep(index);
            }}
          >
            {index + 1}. {label}
          </a>
        ))}
      </nav>

      {step === 0 ? (
        <fieldset>
          <legend>Borrower and product</legend>
          {hasGroups ? (
            <label>
              Borrower type
              <select onChange={(event) => setBorrowerType(event.target.value === "group" ? "group" : "client")} value={borrowerType}>
                <option value="client">Client (individual)</option>
                <option value="group">Group (SACCO / savings group)</option>
              </select>
            </label>
          ) : null}
          {borrowerType === "group" && hasGroups ? (
            <label>
              Group
              <select onChange={(event) => setGroupId(event.target.value)} required value={groupId}>
                <option value="" disabled>Select group</option>
                {groups!.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.accountNumber}</option>)}
              </select>
            </label>
          ) : (
            <label>
              Client
              <select onChange={(event) => setClientId(event.target.value)} required value={clientId}>
                <option value="" disabled>Select active client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.accountNumber}</option>)}
              </select>
            </label>
          )}
          <label>
            Loan product
            <select onChange={(event) => selectProduct(event.target.value)} required value={productId}>
              <option value="" disabled>Select product</option>
              {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency} {item.minimum} to {item.maximum}</option>)}
            </select>
          </label>
          <div className="form-row">
            <label>
              Loan officer
              <select onChange={(event) => setLoanOfficerId(event.target.value)} value={loanOfficerId}>
                <option value="">Unassigned</option>
                {officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.name}</option>)}
              </select>
            </label>
            <label>
              Fund
              <select onChange={(event) => setFundId(event.target.value)} value={fundId}>
                <option value="">Unassigned</option>
                {funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>Application expiry date<input onChange={(event) => setApplicationExpiresOn(event.target.value)} type="date" value={applicationExpiresOn} /></label>
            <label>External ID<input onChange={(event) => setExternalId(event.target.value)} value={externalId} /></label>
          </div>
        </fieldset>
      ) : null}

      {step === 1 ? (
        <fieldset>
          <legend>Application terms</legend>
          <label>Requested principal ({product?.currency ?? "UGX"})<input inputMode="decimal" onChange={(event) => setAmount(event.target.value)} pattern="[0-9]+([.][0-9]{1,2})?" required value={amount} /></label>
          {product ? <p className="muted-text">Allowed range: {product.currency} {product.minimum} – {product.maximum}</p> : null}
          <label>Loan purpose<textarea onChange={(event) => setPurpose(event.target.value)} rows={3} value={purpose} /></label>
          <div className="form-row">
            <label>Nominal interest rate %<input min={0} onChange={(event) => { setAnnualRatePercent(event.target.value); markTermsTouched(); }} step="0.01" type="number" value={annualRatePercent} /></label>
            <label>Monitoring fee % (per year)<input min={0} onChange={(event) => { setMonitoringFeeAnnualRatePercent(event.target.value); markTermsTouched(); }} step="0.01" type="number" value={monitoringFeeAnnualRatePercent} /></label>
          </div>
          <div className="form-row three">
            <label>Number of repayments<input min={1} onChange={(event) => { setRepaymentCount(event.target.value); markTermsTouched(); }} type="number" value={repaymentCount} /></label>
            <label>Repaid every<input onChange={(event) => { setRepaymentFrequency(event.target.value); markTermsTouched(); }} placeholder="1 Months" value={repaymentFrequency} /></label>
            <label>Interest method<select onChange={(event) => { setInterestMethod(event.target.value); markTermsTouched(); }} value={interestMethod}><option value="Flat">Flat</option><option value="Declining Balance">Declining Balance</option></select></label>
          </div>
          <div className="form-row three">
            <label>Amortization<input onChange={(event) => { setAmortizationMethod(event.target.value); markTermsTouched(); }} value={amortizationMethod} /></label>
            <label>First repayment on<input onChange={(event) => { setFirstRepaymentOn(event.target.value); markTermsTouched(); }} type="date" value={firstRepaymentOn} /></label>
            <label>Arrears tolerance ({product?.currency ?? "UGX"})<input inputMode="decimal" onChange={(event) => { setArrearsTolerance(event.target.value); markTermsTouched(); }} value={arrearsTolerance} /></label>
          </div>
        </fieldset>
      ) : null}

      {step === 2 ? (
        <fieldset>
          <legend>Charges</legend>
          {charges.length === 0 ? <p className="muted-text">No loan charges configured yet.</p> : (
            <div className="check-row">
              {charges.map((charge) => (
                <label key={charge.id}>
                  <input checked={selectedCharges.has(charge.id)} onChange={() => toggleCharge(charge.id)} type="checkbox" />
                  {" "}{charge.name}
                  {charge.calculationType === "FLAT" ? ` · ${formatMinor(BigInt(charge.amountMinor ?? "0"), charge.currencyCode)}` : ` · ${((charge.percentageBps ?? 0) / 100).toFixed(2)}%`}
                </label>
              ))}
            </div>
          )}
          <legend>Collateral</legend>
          {collateral.map((row, index) => (
            <div className="form-row three" key={index}>
              <label>Type<input onChange={(event) => updateCollateralRow(index, { type: event.target.value })} placeholder="e.g. Land title" value={row.type} /></label>
              <label>Value ({product?.currency ?? "UGX"})<input inputMode="decimal" onChange={(event) => updateCollateralRow(index, { estimatedValue: event.target.value })} value={row.estimatedValue} /></label>
              <label>Description<input onChange={(event) => updateCollateralRow(index, { description: event.target.value })} value={row.description} /></label>
              <button aria-label="Remove collateral" className="icon-action danger" onClick={() => removeCollateralRow(index)} type="button"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="form-actions" style={{ justifyContent: "flex-start" }}>
            <button className="secondary-action" onClick={addCollateralRow} type="button"><Plus size={14} /> Add collateral</button>
          </div>
        </fieldset>
      ) : null}

      {step === 3 ? (
        <fieldset>
          <legend>Review</legend>
          <dl className="detail-grid">
            <div><dt>Borrower</dt><dd>{borrowerType === "group" ? (selectedGroupLabel?.name ?? "Not selected") : (selectedClientLabel?.name ?? "Not selected")}</dd></div>
            <div><dt>Product</dt><dd>{product?.name ?? "Not selected"}</dd></div>
            <div><dt>Loan officer</dt><dd>{selectedOfficerLabel?.name ?? "Unassigned"}</dd></div>
            <div><dt>Loan purpose</dt><dd>{purpose || "—"}</dd></div>
            <div><dt>Fund</dt><dd>{selectedFundLabel?.name ?? "—"}</dd></div>
            <div><dt>Application expiry</dt><dd>{applicationExpiresOn || "—"}</dd></div>
            <div><dt>External ID</dt><dd>{externalId || "—"}</dd></div>
            <div><dt>Principal</dt><dd>{amount ? `${product?.currency ?? "UGX"} ${amount}` : "—"}</dd></div>
            <div><dt>Nominal interest rate</dt><dd>{annualRatePercent ? `${annualRatePercent}% per year` : "Product default"}</dd></div>
            <div><dt>Monitoring fee</dt><dd>{monitoringFeeAnnualRatePercent ? `${monitoringFeeAnnualRatePercent}% per year` : "Product default"}</dd></div>
            <div><dt>Repayment plan</dt><dd>{repaymentCount && repaymentFrequency ? `${repaymentCount} × ${repaymentFrequency}` : "Product default"}</dd></div>
            <div><dt>Interest method</dt><dd>{interestMethod || "Product default"}</dd></div>
            <div><dt>Amortization</dt><dd>{amortizationMethod || "Product default"}</dd></div>
            <div><dt>First repayment</dt><dd>{firstRepaymentOn || "Product schedule"}</dd></div>
            <div><dt>Arrears tolerance</dt><dd>{arrearsTolerance ? formatMinor(BigInt(toMinor(arrearsTolerance) ?? "0"), product?.currency ?? "UGX") : "Product default"}</dd></div>
            <div><dt>Charges</dt><dd>{selectedCharges.size === 0 ? "None" : charges.filter((charge) => selectedCharges.has(charge.id)).map((charge) => charge.name).join(", ")}</dd></div>
            <div><dt>Collateral</dt><dd>{collateral.length === 0 ? "None" : collateral.map((row) => row.type || row.description || "Item").join(", ")}</dd></div>
          </dl>
        </fieldset>
      ) : null}

      <div className="form-actions">
        <button className="secondary-action" disabled={step === 0} onClick={() => setStep((current) => current - 1)} type="button">Back</button>
        {step < steps.length - 1 ? (
          <button className="invest-button" disabled={(step === 0 && !detailsValid()) || (step === 1 && !termsValid())} onClick={() => setStep((current) => current + 1)} type="button">Next</button>
        ) : (
          <button className="invest-button" disabled={pending} onClick={submit} type="button">{pending ? <LoaderCircle className="spin" size={18} /> : <CircleDollarSign size={18} />} Submit loan application</button>
        )}
      </div>
    </div>
  );
}

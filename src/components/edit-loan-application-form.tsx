"use client";

import { CircleDollarSign, LoaderCircle, Plus, SquarePen, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

import {
  buildChargePayload,
  buildCollateralPayload,
  buildTermsPayload,
  type ChargeDraft,
  type ChargeOption,
  type CollateralDraft,
  fromMinor,
  type FundOption,
  type OfficerOption,
  type ProductOption,
  toMinor,
} from "@/components/loan-application-form-shared";
import { formatMinor } from "@/modules/money/domain/format-minor";

type TermsDraft = Readonly<{
  annualRatePercent: string;
  monitoringFeeAnnualRatePercent: string;
  repaymentCount: string;
  repaymentFrequency: string;
  interestMethod: string;
  amortizationMethod: string;
  firstRepaymentOn: string;
  arrearsTolerance: string;
}>;

function cloneCollateral(items: readonly CollateralDraft[]) {
  return items.map((item) => ({ ...item }));
}

export function EditLoanApplicationForm({
  applicationId,
  borrowerLabel,
  charges,
  initialAmount,
  initialApplicationExpiresOn,
  initialChargeIds,
  initialCollateral,
  initialExternalId,
  initialFundId,
  initialLoanOfficerId,
  initialPurpose,
  initialTerms,
  officers,
  preservedCharges,
  product,
  funds,
}: {
  applicationId: string;
  borrowerLabel: string;
  charges: readonly ChargeOption[];
  initialAmount: string;
  initialApplicationExpiresOn: string;
  initialChargeIds: readonly string[];
  initialCollateral: readonly CollateralDraft[];
  initialExternalId: string;
  initialFundId: string;
  initialLoanOfficerId: string;
  initialPurpose: string;
  initialTerms: TermsDraft;
  officers: readonly OfficerOption[];
  preservedCharges: readonly ChargeDraft[];
  product: ProductOption;
  funds: readonly FundOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const [amount, setAmount] = useState(initialAmount);
  const [purpose, setPurpose] = useState(initialPurpose);
  const [externalId, setExternalId] = useState(initialExternalId);
  const [applicationExpiresOn, setApplicationExpiresOn] = useState(initialApplicationExpiresOn);
  const [fundId, setFundId] = useState(initialFundId);
  const [loanOfficerId, setLoanOfficerId] = useState(initialLoanOfficerId);
  const [annualRatePercent, setAnnualRatePercent] = useState(initialTerms.annualRatePercent);
  const [monitoringFeeAnnualRatePercent, setMonitoringFeeAnnualRatePercent] = useState(initialTerms.monitoringFeeAnnualRatePercent);
  const [repaymentCount, setRepaymentCount] = useState(initialTerms.repaymentCount);
  const [repaymentFrequency, setRepaymentFrequency] = useState(initialTerms.repaymentFrequency);
  const [interestMethod, setInterestMethod] = useState(initialTerms.interestMethod);
  const [amortizationMethod, setAmortizationMethod] = useState(initialTerms.amortizationMethod);
  const [firstRepaymentOn, setFirstRepaymentOn] = useState(initialTerms.firstRepaymentOn);
  const [arrearsTolerance, setArrearsTolerance] = useState(initialTerms.arrearsTolerance);
  const [selectedCharges, setSelectedCharges] = useState<Set<string>>(new Set(initialChargeIds));
  const [collateral, setCollateral] = useState<CollateralDraft[]>(cloneCollateral(initialCollateral));

  function resetForm() {
    setAmount(initialAmount);
    setPurpose(initialPurpose);
    setExternalId(initialExternalId);
    setApplicationExpiresOn(initialApplicationExpiresOn);
    setFundId(initialFundId);
    setLoanOfficerId(initialLoanOfficerId);
    setAnnualRatePercent(initialTerms.annualRatePercent);
    setMonitoringFeeAnnualRatePercent(initialTerms.monitoringFeeAnnualRatePercent);
    setRepaymentCount(initialTerms.repaymentCount);
    setRepaymentFrequency(initialTerms.repaymentFrequency);
    setInterestMethod(initialTerms.interestMethod);
    setAmortizationMethod(initialTerms.amortizationMethod);
    setFirstRepaymentOn(initialTerms.firstRepaymentOn);
    setArrearsTolerance(initialTerms.arrearsTolerance);
    setSelectedCharges(new Set(initialChargeIds));
    setCollateral(cloneCollateral(initialCollateral));
  }

  function close() {
    resetForm();
    setOpen(false);
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

  async function submit() {
    const proposedPrincipalMinor = toMinor(amount);
    if (!proposedPrincipalMinor) {
      toast.error("Enter a valid loan amount");
      return;
    }
    if (BigInt(proposedPrincipalMinor) < BigInt(product.minimumMinor) || BigInt(proposedPrincipalMinor) > BigInt(product.maximumMinor)) {
      toast.error(`Principal must be between ${product.currency} ${product.minimum} and ${product.maximum}`);
      return;
    }

    setPending(true);
    const response = await fetch(`/api/loan-applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposedPrincipalMinor,
        purpose: purpose.trim() || null,
        externalId: externalId.trim() || null,
        applicationExpiresOn: applicationExpiresOn || null,
        fundId: fundId || null,
        loanOfficerId: loanOfficerId || null,
        terms: buildTermsPayload({
          annualRatePercent,
          monitoringFeeAnnualRatePercent,
          repaymentCount,
          repaymentFrequency,
          interestMethod,
          amortizationMethod,
          firstRepaymentOn,
          arrearsTolerance,
        }),
        charges: buildChargePayload({
          charges,
          preservedCharges,
          proposedPrincipalMinor,
          selectedChargeIds: selectedCharges,
        }),
        collateral: buildCollateralPayload(collateral),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Loan application could not be updated");
      return;
    }
    toast.success("Loan application updated");
    setOpen(false);
    router.refresh();
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <h2>Edit application</h2>
          <p>Correct this submitted application before the review decision is recorded.</p>
        </div>
        {open ? (
          <button className="secondary-action" onClick={close} type="button">
            <X size={14} /> Close
          </button>
        ) : (
          <button className="secondary-action" onClick={() => setOpen(true)} type="button">
            <SquarePen size={14} /> Edit application
          </button>
        )}
      </div>
      {open ? (
        <form className="entity-form compact-mapping" onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}>
          <fieldset>
            <legend>Pending-review details</legend>
            <dl className="detail-grid">
              <div><dt>Borrower</dt><dd>{borrowerLabel}</dd></div>
              <div><dt>Product</dt><dd>{product.name}</dd></div>
            </dl>
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
              <label>
                Application expiry date
                <input onChange={(event) => setApplicationExpiresOn(event.target.value)} type="date" value={applicationExpiresOn} />
              </label>
              <label>
                External ID
                <input onChange={(event) => setExternalId(event.target.value)} value={externalId} />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Application terms</legend>
            <label>
              Requested principal ({product.currency})
              <input inputMode="decimal" onChange={(event) => setAmount(event.target.value)} pattern="[0-9]+([.][0-9]{1,2})?" required value={amount} />
            </label>
            <p className="muted-text">Allowed range: {product.currency} {product.minimum} – {product.maximum}</p>
            <label>
              Loan purpose
              <textarea onChange={(event) => setPurpose(event.target.value)} rows={3} value={purpose} />
            </label>
            <div className="form-row">
              <label>
                Nominal interest rate %
                <input min={0} onChange={(event) => setAnnualRatePercent(event.target.value)} step="0.01" type="number" value={annualRatePercent} />
              </label>
              <label>
                Monitoring fee % (per year)
                <input min={0} onChange={(event) => setMonitoringFeeAnnualRatePercent(event.target.value)} step="0.01" type="number" value={monitoringFeeAnnualRatePercent} />
              </label>
            </div>
            <div className="form-row three">
              <label>
                Number of repayments
                <input min={1} onChange={(event) => setRepaymentCount(event.target.value)} type="number" value={repaymentCount} />
              </label>
              <label>
                Repaid every
                <input onChange={(event) => setRepaymentFrequency(event.target.value)} placeholder="1 Months" value={repaymentFrequency} />
              </label>
              <label>
                Interest method
                <select onChange={(event) => setInterestMethod(event.target.value)} value={interestMethod}>
                  <option value="">Use product default</option>
                  <option value="Flat">Flat</option>
                  <option value="Declining Balance">Declining Balance</option>
                </select>
              </label>
            </div>
            <div className="form-row three">
              <label>
                Amortization
                <input onChange={(event) => setAmortizationMethod(event.target.value)} value={amortizationMethod} />
              </label>
              <label>
                First repayment on
                <input onChange={(event) => setFirstRepaymentOn(event.target.value)} type="date" value={firstRepaymentOn} />
              </label>
              <label>
                Arrears tolerance ({product.currency})
                <input inputMode="decimal" onChange={(event) => setArrearsTolerance(event.target.value)} value={arrearsTolerance} />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Charges</legend>
            {charges.length === 0 ? (
              <p className="muted-text">No loan charges configured yet.</p>
            ) : (
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
            {preservedCharges.length > 0 ? (
              <p className="muted-text">
                {preservedCharges.length} historical charge selection{preservedCharges.length === 1 ? "" : "s"} will be preserved automatically because their definitions are no longer available to edit here.
              </p>
            ) : null}
          </fieldset>

          <fieldset>
            <legend>Collateral</legend>
            {collateral.map((row, index) => (
              <div className="form-row three" key={index}>
                <label>
                  Type
                  <input onChange={(event) => updateCollateralRow(index, { type: event.target.value })} placeholder="e.g. Land title" value={row.type} />
                </label>
                <label>
                  Value ({product.currency})
                  <input inputMode="decimal" onChange={(event) => updateCollateralRow(index, { estimatedValue: event.target.value })} value={row.estimatedValue} />
                </label>
                <label>
                  Description
                  <input onChange={(event) => updateCollateralRow(index, { description: event.target.value })} value={row.description} />
                </label>
                <button aria-label="Remove collateral" className="icon-action danger" onClick={() => removeCollateralRow(index)} type="button"><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="form-actions" style={{ justifyContent: "flex-start" }}>
              <button className="secondary-action" onClick={addCollateralRow} type="button"><Plus size={14} /> Add collateral</button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Review changes</legend>
            <dl className="detail-grid">
              <div><dt>Principal</dt><dd>{amount ? `${product.currency} ${amount}` : "—"}</dd></div>
              <div><dt>Purpose</dt><dd>{purpose || "—"}</dd></div>
              <div><dt>Loan officer</dt><dd>{officers.find((officer) => officer.id === loanOfficerId)?.name ?? "Unassigned"}</dd></div>
              <div><dt>Fund</dt><dd>{funds.find((fund) => fund.id === fundId)?.name ?? "Unassigned"}</dd></div>
              <div><dt>Application expiry</dt><dd>{applicationExpiresOn || "—"}</dd></div>
              <div><dt>External ID</dt><dd>{externalId || "—"}</dd></div>
              <div><dt>Nominal interest rate</dt><dd>{annualRatePercent ? `${annualRatePercent}% per year` : "Product default"}</dd></div>
              <div><dt>Monitoring fee</dt><dd>{monitoringFeeAnnualRatePercent ? `${monitoringFeeAnnualRatePercent}% per year` : "Product default"}</dd></div>
              <div><dt>Repayment plan</dt><dd>{repaymentCount && repaymentFrequency ? `${repaymentCount} × ${repaymentFrequency}` : "Product default"}</dd></div>
              <div><dt>Interest method</dt><dd>{interestMethod || "Product default"}</dd></div>
              <div><dt>Amortization</dt><dd>{amortizationMethod || "Product default"}</dd></div>
              <div><dt>Arrears tolerance</dt><dd>{arrearsTolerance ? formatMinor(BigInt(toMinor(arrearsTolerance) ?? "0"), product.currency) : "Product default"}</dd></div>
              <div><dt>Charges</dt><dd>{selectedCharges.size === 0 ? "None" : charges.filter((charge) => selectedCharges.has(charge.id)).map((charge) => charge.name).join(", ")}</dd></div>
              <div><dt>Collateral</dt><dd>{collateral.length === 0 ? "None" : collateral.map((row) => row.type || row.description || (row.estimatedValue ? `Item ${fromMinor(toMinor(row.estimatedValue) ?? "0")}` : "Item")).join(", ")}</dd></div>
            </dl>
          </fieldset>

          <div className="form-actions">
            <button className="secondary-action" disabled={pending} onClick={close} type="button">Cancel</button>
            <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <CircleDollarSign size={18} />} type="submit">
              Save changes
            </BrandActionButton>
          </div>
        </form>
      ) : (
        <div className="empty-state compact-empty">
          <strong>Need to fix something before approval?</strong>
          <p>Edit the submitted details here without touching any approved or disbursed loan records.</p>
        </div>
      )}
    </article>
  );
}

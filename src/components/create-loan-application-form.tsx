"use client";

import { CircleDollarSign, Eye, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { LoanPreviewDialog, type LoanPreviewInput } from "@/components/loan-preview-panel";
import { BrandActionButton } from "@/components/ui/brand-action-button";
import { type DialogHandle } from "@/components/ui/dialog";

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
import { annualBpsFromMonthlyPercent } from "@/modules/lending/domain/monthly-rate";
import { generateRepaymentSchedule, INTEREST_DAY_COUNT } from "@/modules/lending/domain/repayment-schedule";

type ClientOption = Readonly<{ id: string; name: string; accountNumber: string }>;
type GroupOption = Readonly<{ id: string; name: string; accountNumber: string; members: readonly ClientOption[] }>;

const steps = ["Details", "Terms", "Charges", "Review"] as const;

function normalizeInterestMethod(value: string | null | undefined) {
  if (value === "DECLINING_BALANCE") return "Declining Balance";
  if (value === "FLAT") return "Flat";
  return value ?? "";
}

function NewLoanRepaymentPreview({
  amount,
  annualRatePercent,
  currency,
  interestMethod,
  monitoringFeeAnnualRatePercent,
  repaymentCount,
  repaymentFrequency,
}: {
  amount: string;
  annualRatePercent: string;
  currency: string;
  interestMethod: string;
  monitoringFeeAnnualRatePercent: string;
  repaymentCount: string;
  repaymentFrequency: string;
}) {
  const preview = useMemo(() => {
    const principalMinor = toMinor(amount);
    const count = Number(repaymentCount);
    if (!principalMinor || !Number.isInteger(count) || count <= 0 || !repaymentFrequency.trim()) return null;
    try {
      const schedule = generateRepaymentSchedule({
        principalMinor: BigInt(principalMinor),
        annualRateBps: annualBpsFromMonthlyPercent(Number(annualRatePercent || 0)),
        monitoringFeeAnnualRateBps: annualBpsFromMonthlyPercent(Number(monitoringFeeAnnualRatePercent || 0)),
        repaymentCount: count,
        repaymentFrequency,
        interestMethod: interestMethod || "Flat",
        interestDayCount: INTEREST_DAY_COUNT.FOUR_WEEK_MONTH,
        disbursedOn: new Date("2026-01-01T00:00:00Z"),
      });
      const installmentDueMinor = schedule[0].principalDueMinor + schedule[0].interestDueMinor + schedule[0].monitoringFeeDueMinor;
      return {
        count: schedule.length,
        installmentDueMinor,
        totalInterestMinor: schedule.reduce((sum, item) => sum + item.interestDueMinor, 0n),
        totalMonitoringMinor: schedule.reduce((sum, item) => sum + item.monitoringFeeDueMinor, 0n),
        weekly: repaymentFrequency.toUpperCase().includes("WEEK"),
      };
    } catch {
      return null;
    }
  }, [amount, annualRatePercent, interestMethod, monitoringFeeAnnualRatePercent, repaymentCount, repaymentFrequency]);

  if (!preview) return null;

  return (
    <aside className="configuration-note">
      <strong>
        {formatMinor(preview.installmentDueMinor, currency)} {preview.weekly ? "every 7 days" : `× ${preview.count}`}
      </strong>
      <span>
        Principal + interest{preview.totalMonitoringMinor > 0n ? " + maintenance" : ""} split across {preview.count}{" "}
        {preview.weekly ? "weekly" : ""} installments. Interest {formatMinor(preview.totalInterestMinor, currency)}
        {preview.totalMonitoringMinor > 0n ? ` · maintenance ${formatMinor(preview.totalMonitoringMinor, currency)}` : ""}.
      </span>
    </aside>
  );
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
  const previewRef = useRef<DialogHandle>(null);
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
  const selectedGroup = groups?.find((group) => group.id === groupId);
  const groupMembers = selectedGroup?.members ?? [];

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
    const ownerOk = borrowerType === "group" ? Boolean(groupId && clientId) : Boolean(clientId);
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
    if (borrowerType === "group" && (!groupId || !groupMembers.some((member) => member.id === clientId))) {
      toast.error("Select a group member to receive this loan");
      return;
    }
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
    const owner = borrowerType === "group" ? { clientId, groupId } : { clientId };
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

  const selectedClientLabel = (borrowerType === "group" ? groupMembers : clients).find((client) => client.id === clientId);
  const selectedGroupLabel = selectedGroup;
  const selectedOfficerLabel = officers.find((officer) => officer.id === loanOfficerId);
  const selectedFundLabel = funds.find((fund) => fund.id === fundId);
  const previewInput = useMemo((): LoanPreviewInput | null => {
    const principalMinor = toMinor(amount);
    if (!principalMinor || !product) return null;
    const chargePayload = buildChargePayload({ charges, proposedPrincipalMinor: principalMinor, selectedChargeIds: selectedCharges });
    return {
      borrowerLabel:
        borrowerType === "group"
          ? [selectedClientLabel?.name, selectedGroupLabel?.name].filter(Boolean).join(" · ") || "Not selected"
          : (selectedClientLabel?.name ?? "Not selected"),
      productName: product.name,
      currency: product.currency,
      principalMinor,
      annualRatePercent,
      monitoringFeeAnnualRatePercent,
      repaymentCount,
      repaymentFrequency,
      interestMethod,
      amortizationMethod,
      interestDayCount: INTEREST_DAY_COUNT.FOUR_WEEK_MONTH,
      firstRepaymentOn: firstRepaymentOn || undefined,
      charges: chargePayload.map((charge) => ({
        name: charge.name,
        amountLabel: formatMinor(BigInt(charge.amountMinor), product.currency),
        amountMinor: charge.amountMinor,
      })),
      collateralLabel:
        collateral
          .filter((row) => row.type.trim() || row.description.trim())
          .map((row) => row.type || row.description)
          .join(", ") || undefined,
      officerName: selectedOfficerLabel?.name,
      purpose: purpose.trim() || undefined,
    };
  }, [
    amortizationMethod,
    amount,
    annualRatePercent,
    borrowerType,
    charges,
    collateral,
    firstRepaymentOn,
    interestMethod,
    monitoringFeeAnnualRatePercent,
    product,
    purpose,
    repaymentCount,
    repaymentFrequency,
    selectedCharges,
    selectedClientLabel?.name,
    selectedGroupLabel?.name,
    selectedOfficerLabel?.name,
  ]);

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
              <select
                onChange={(event) => {
                  const next = event.target.value === "group" ? "group" : "client";
                  setBorrowerType(next);
                  setClientId("");
                  if (next === "client") setGroupId("");
                }}
                value={borrowerType}
              >
                <option value="client">Client (individual)</option>
                <option value="group">Group member</option>
              </select>
            </label>
          ) : null}
          {borrowerType === "group" && hasGroups ? (
            <>
              <label>
                Group
                <select
                  onChange={(event) => {
                    setGroupId(event.target.value);
                    setClientId("");
                  }}
                  required
                  value={groupId}
                >
                  <option value="" disabled>Select group</option>
                  {groups!.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.accountNumber}</option>)}
                </select>
              </label>
              <label>
                Member
                <select disabled={!groupId} onChange={(event) => setClientId(event.target.value)} required value={clientId}>
                  <option value="" disabled>{groupId ? "Select member" : "Select a group first"}</option>
                  {groupMembers.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.accountNumber}</option>)}
                </select>
              </label>
              {groupId && groupMembers.length === 0 ? <p className="muted-text">This group has no active members to lend to.</p> : <p className="muted-text">The loan is issued to the selected member, not the group as a whole.</p>}
            </>
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
            <label>Nominal interest rate % per month<input min={0} onChange={(event) => { setAnnualRatePercent(event.target.value); markTermsTouched(); }} step="0.01" type="number" value={annualRatePercent} /></label>
            <label>Monitoring fee % per month<input min={0} onChange={(event) => { setMonitoringFeeAnnualRatePercent(event.target.value); markTermsTouched(); }} step="0.01" type="number" value={monitoringFeeAnnualRatePercent} /></label>
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
          <NewLoanRepaymentPreview
            amount={amount}
            annualRatePercent={annualRatePercent}
            currency={product?.currency ?? "UGX"}
            interestMethod={interestMethod}
            monitoringFeeAnnualRatePercent={monitoringFeeAnnualRatePercent}
            repaymentCount={repaymentCount}
            repaymentFrequency={repaymentFrequency}
          />
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
            <div><dt>Borrower</dt><dd>{borrowerType === "group" ? (selectedClientLabel && selectedGroupLabel ? `${selectedClientLabel.name} · ${selectedGroupLabel.name}` : "Not selected") : (selectedClientLabel?.name ?? "Not selected")}</dd></div>
            <div><dt>Product</dt><dd>{product?.name ?? "Not selected"}</dd></div>
            <div><dt>Loan officer</dt><dd>{selectedOfficerLabel?.name ?? "Unassigned"}</dd></div>
            <div><dt>Loan purpose</dt><dd>{purpose || "—"}</dd></div>
            <div><dt>Fund</dt><dd>{selectedFundLabel?.name ?? "—"}</dd></div>
            <div><dt>Application expiry</dt><dd>{applicationExpiresOn || "—"}</dd></div>
            <div><dt>External ID</dt><dd>{externalId || "—"}</dd></div>
            <div><dt>Principal</dt><dd>{amount ? `${product?.currency ?? "UGX"} ${amount}` : "—"}</dd></div>
            <div><dt>Nominal interest rate</dt><dd>{annualRatePercent ? `${annualRatePercent}% per month` : "Product default"}</dd></div>
            <div><dt>Monitoring fee</dt><dd>{monitoringFeeAnnualRatePercent ? `${monitoringFeeAnnualRatePercent}% per month` : "Product default"}</dd></div>
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
          <BrandActionButton
            disabled={pending}
            icon={pending ? <LoaderCircle className="spin" size={18} /> : <Eye size={18} />}
            onClick={() => {
              if (!previewInput) {
                toast.error("Enter loan terms before previewing");
                return;
              }
              previewRef.current?.showModal();
            }}
            type="button"
          >
            Preview loan
          </BrandActionButton>
        )}
      </div>
      {previewInput ? (
        <LoanPreviewDialog dialogRef={previewRef} input={previewInput} title="Preview loan application">
          <div className="form-actions">
            <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <CircleDollarSign size={18} />} onClick={submit} type="button">
              Submit loan application
            </BrandActionButton>
          </div>
        </LoanPreviewDialog>
      ) : null}
    </div>
  );
}

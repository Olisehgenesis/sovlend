"use client";

import { LoaderCircle, PiggyBank } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DisbursementPayoutPreview, type DisbursementPayoutContext } from "@/components/disbursement-payout-preview";
import { BrandActionButton } from "@/components/ui/brand-action-button";
import { LoanPreviewPanel, type LoanPreviewInput } from "@/components/loan-preview-panel";
import { PAYEE_TYPE_LABELS, PAYEE_TYPES, payeeReferencePlaceholder, type PayeeType } from "@/modules/ledger/domain/journal";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { processingFeePercentSchema } from "@/modules/lending/domain/processing-fee";

type SettlementAccountOption = Readonly<{
  id: string;
  name: string;
  type: string;
}>;

type SavingsAccountOption = Readonly<{
  id: string;
  accountNumber: string;
  isDefault: boolean;
  productName?: string | null;
}>;

type PayoffLoanOption = Readonly<{
  id: string;
  accountNumber: string;
  outstandingMinor: string;
  currencyCode: string;
}>;

export function DisburseLoanForm({
  loanId,
  settlementAccounts,
  savingsAccounts = [],
  payoffLoanOptions = [],
  preview,
  payout,
  onSuccess,
  initialAsTopUp = false,
}: {
  loanId: string;
  settlementAccounts: SettlementAccountOption[];
  savingsAccounts?: SavingsAccountOption[];
  payoffLoanOptions?: PayoffLoanOption[];
  preview?: LoanPreviewInput;
  payout?: DisbursementPayoutContext;
  onSuccess?: () => void;
  initialAsTopUp?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [processingPercent, setProcessingPercent] = useState(String((payout?.processingFeeBps ?? 200) / 100));
  const parsedProcessing = processingFeePercentSchema.safeParse(processingPercent === "" ? NaN : processingPercent);
  const [collectCrb, setCollectCrb] = useState(payout?.collectCrb !== false);
  const [collectProcessingFee, setCollectProcessingFee] = useState(payout?.collectProcessingFee !== false);
  const [collectLif, setCollectLif] = useState(payout?.collectLif !== false);
  const [collectExtraCharges, setCollectExtraCharges] = useState(payout?.collectExtraCharges !== false);
  const [payOffPrevious, setPayOffPrevious] = useState(initialAsTopUp && payoffLoanOptions.length > 0);
  const [selectedTopUpLoanId, setSelectedTopUpLoanId] = useState(payoffLoanOptions[0]?.id ?? "");
  const [payeeType, setPayeeType] = useState<PayeeType | "">("");
  const defaultSavingsAccountId = useMemo(
    () => savingsAccounts.find((account) => account.isDefault)?.id ?? savingsAccounts[0]?.id ?? "",
    [savingsAccounts],
  );
  // Cash is the most common payment method in practice, so pre-select it over whatever
  // bank/mobile-money account happens to be listed first.
  const defaultSettlementAccountId = useMemo(
    () => settlementAccounts.find((account) => account.type === "CASH")?.id ?? settlementAccounts[0]?.id ?? "",
    [settlementAccounts],
  );
  const referencePlaceholder = payeeReferencePlaceholder(payeeType);

  async function disburse(formData: FormData) {
    if (!parsedProcessing.success) { toast.error("Enter a processing percentage from 0 to 100, with at most two decimal places"); return; }
    const savingsAccountId = String(formData.get("savingsAccountId") || defaultSavingsAccountId || "");
    const paymentMethodSettlementAccountId = String(formData.get("paymentMethodSettlementAccountId") || "");
    const topUpOfLoanId = payOffPrevious ? String(formData.get("topUpOfLoanId") || "") : "";

    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/disburse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savingsAccountId: savingsAccountId || undefined,
        processingFeeBps: payout?.currency === "UGX" && collectProcessingFee ? Math.round(parsedProcessing.data * 100) : 0,
        collectCrb,
        collectProcessingFee,
        collectLif,
        collectExtraCharges,
        paymentMethodSettlementAccountId: paymentMethodSettlementAccountId || undefined,
        businessDate: formData.get("businessDate"),
        externalReference: formData.get("externalReference") || undefined,
        idempotencyKey: crypto.randomUUID(),
        topUpOfLoanId: topUpOfLoanId || undefined,
        payeeType: formData.get("payeeType") || undefined,
        payeeName: formData.get("payeeName") || undefined,
        payeeReference: formData.get("payeeReference") || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Loan could not be disbursed");
      return;
    }
    toast.success(
      topUpOfLoanId
        ? "Loan disbursed — previous loan liquidated from the proceeds"
        : "Loan disbursed and repayment schedule created",
    );
    router.refresh();
    onSuccess?.();
  }

  const submitDisabled = pending || (payout?.currency === "UGX" && collectProcessingFee && !parsedProcessing.success);

  return (
    <form action={disburse} className="entity-form compact-mapping">
      {payoffLoanOptions.length > 0 ? (
        <fieldset disabled={pending}>
          <legend>Disbursement type</legend>
          <label className="check-row"><input type="radio" name="disbursementType" checked={!payOffPrevious} onChange={() => setPayOffPrevious(false)} />Standard disbursement — keep the existing loan</label>
          <label className="check-row"><input type="radio" name="disbursementType" checked={payOffPrevious} onChange={() => setPayOffPrevious(true)} />Disburse as top-up — deduct the existing loan balance from proceeds</label>
          {payOffPrevious ? <label>Existing loan to pay off<select name="topUpOfLoanId" value={selectedTopUpLoanId} required onChange={event => setSelectedTopUpLoanId(event.target.value)}>{payoffLoanOptions.map(option => <option key={option.id} value={option.id}>{option.accountNumber} · outstanding {formatMinor(BigInt(option.outstandingMinor), option.currencyCode)}</option>)}</select></label> : null}
          <p className="field-hint">{payout?.lifExempt ? "This loan is LIF-exempt. Existing LIF savings remain unchanged in either option." : "The preview recalculates LIF and cash payable for the chosen option."} If proceeds cannot clear the existing loan, the preview shows the partial payment and remaining cash.</p>
        </fieldset>
      ) : null}
      {payout?.currency === "UGX" || preview?.currency === "UGX" ? (
        <p className="field-hint"><strong>Untick any deduction this loan should not take.</strong> Processing, the catalog UGX 10,000 fee, CRB, LIF, and other catalog fees only come off proceeds when ticked. They are not added to the repayment schedule.</p>
      ) : null}
      {payout ? (
        <fieldset>
          <legend>Disbursement preview</legend>
          <div className="check-row">
            <label><input checked={collectCrb} disabled={pending} onChange={(event) => setCollectCrb(event.target.checked)} type="checkbox" /> Collect CRB</label>
            <label><input checked={collectProcessingFee} disabled={pending} onChange={(event) => setCollectProcessingFee(event.target.checked)} type="checkbox" /> Collect processing fee</label>
            <label><input checked={collectLif} disabled={pending} onChange={(event) => setCollectLif(event.target.checked)} type="checkbox" /> Hold LIF</label>
            <label><input checked={collectExtraCharges} disabled={pending} onChange={(event) => setCollectExtraCharges(event.target.checked)} type="checkbox" /> Collect other catalog fees</label>
          </div>
          {payout.currency === "UGX" && collectProcessingFee ? <label>Processing fee % for this loan<input type="number" min={0} max={100} step="0.01" required value={processingPercent} disabled={pending} onChange={(event) => setProcessingPercent(event.target.value)} /><small>Changing this updates the preview and actual deduction for this loan only. The change is recorded in the disbursement audit.</small></label> : null}
          {collectProcessingFee && !parsedProcessing.success ? <p role="alert">Enter a valid processing percentage before disbursing.</p> :
          <DisbursementPayoutPreview
            context={{
              ...payout,
              collectCrb,
              collectProcessingFee,
              collectLif,
              collectExtraCharges,
              processingFeeBps: collectProcessingFee && parsedProcessing.success ? Math.round(parsedProcessing.data * 100) : 0,
              lifExempt: payout.lifExempt || !collectLif,
            }}
            liquidateLoanId={payOffPrevious ? selectedTopUpLoanId || payoffLoanOptions[0]?.id : null}
          />}
        </fieldset>
      ) : null}
      {preview ? (
        <fieldset>
          <legend>Repayment preview</legend>
          <LoanPreviewPanel input={preview} />
        </fieldset>
      ) : null}
      <fieldset>
        <legend>Loan payout</legend>
        {savingsAccounts.length === 0 ? (
          <p className="field-hint">This client has no savings accounts yet. Disbursement will open the LIF, member contribution, and security accounts and credit the proceeds there.</p>
        ) : null}
        {settlementAccounts.length > 0 ? (
          <label>
            Payment method
            <select defaultValue={defaultSettlementAccountId} name="paymentMethodSettlementAccountId">
              <option value="">Not recorded</option>
              {settlementAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="form-row">
          <label>
            Business date
            <input
              defaultValue={new Date().toISOString().slice(0, 10)}
              name="businessDate"
              required
              type="date"
            />
          </label>
          <label>
            Receipt / external reference
            <input name="externalReference" />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Cash-out destination (optional)</legend>
        <p className="field-hint">
          Record who the payout actually went to -- a person, an account, mobile money, a card, or a
          Blink/Lightning destination.
        </p>
        <div className="form-row">
          <label>
            Destination type
            <select name="payeeType" value={payeeType} onChange={(event) => setPayeeType(event.target.value as PayeeType | "")}>
              <option value="">Not recorded</option>
              {PAYEE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PAYEE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input name="payeeName" maxLength={200} placeholder="e.g. Jane Nakato" />
          </label>
        </div>
        <label>
          Account / number / reference
          <input name="payeeReference" maxLength={200} placeholder={referencePlaceholder} />
        </label>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={submitDisabled} icon={pending ? <LoaderCircle className="spin" size={18} /> : <PiggyBank size={18} />} type="submit">
          {payOffPrevious ? "Disburse as top-up" : "Disburse loan"}
        </BrandActionButton>
      </div>
    </form>
  );
}

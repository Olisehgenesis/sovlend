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
}: {
  loanId: string;
  settlementAccounts: SettlementAccountOption[];
  savingsAccounts?: SavingsAccountOption[];
  payoffLoanOptions?: PayoffLoanOption[];
  preview?: LoanPreviewInput;
  payout?: DisbursementPayoutContext;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [payOffPrevious, setPayOffPrevious] = useState(false);
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
    const savingsAccountId = String(formData.get("savingsAccountId") || defaultSavingsAccountId || "");
    const paymentMethodSettlementAccountId = String(formData.get("paymentMethodSettlementAccountId") || "");
    const topUpOfLoanId = payOffPrevious ? String(formData.get("topUpOfLoanId") || "") : "";

    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/disburse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savingsAccountId,
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

  const submitDisabled = pending;

  return (
    <form action={disburse} className="entity-form compact-mapping">
      {payout ? (
        <fieldset>
          <legend>Disbursement preview</legend>
          <DisbursementPayoutPreview
            context={payout}
            liquidateLoanId={payOffPrevious ? selectedTopUpLoanId || payoffLoanOptions[0]?.id : null}
          />
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
      {payoffLoanOptions.length > 0 ? (
        <fieldset>
          <legend>Existing loan</legend>
          <label className="check-row">
            <input
              checked={payOffPrevious}
              onChange={(event) => setPayOffPrevious(event.target.checked)}
              type="checkbox"
            />
            Liquidate a previous loan from these proceeds
          </label>
          <p className="field-hint">
            Leave this unchecked to keep both loans. LIF then holds 15% of each active loan. If you
            liquidate, surplus LIF moves to loan security payable.
          </p>
          {payOffPrevious ? (
            <label>
              Loan to liquidate
              <select
                name="topUpOfLoanId"
                onChange={(event) => setSelectedTopUpLoanId(event.target.value)}
                required
                value={selectedTopUpLoanId || payoffLoanOptions[0]?.id}
              >
                {payoffLoanOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.accountNumber} · outstanding {formatMinor(BigInt(option.outstandingMinor), option.currencyCode)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
      ) : null}
      <div className="form-actions">
        <BrandActionButton disabled={submitDisabled} icon={pending ? <LoaderCircle className="spin" size={18} /> : <PiggyBank size={18} />} type="submit">
          Disburse loan
        </BrandActionButton>
      </div>
    </form>
  );
}

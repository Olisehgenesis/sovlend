"use client";

import { LoaderCircle, PiggyBank } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";
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
  onSuccess,
}: {
  loanId: string;
  settlementAccounts: SettlementAccountOption[];
  savingsAccounts?: SavingsAccountOption[];
  payoffLoanOptions?: PayoffLoanOption[];
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [payOffPrevious, setPayOffPrevious] = useState(false);
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

    if (!savingsAccountId) {
      toast.error("Client has no active savings account to credit");
      return;
    }

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
        ? "Loan disbursed — previous loan paid off from the proceeds"
        : "Loan disbursed and repayment schedule created",
    );
    router.refresh();
    onSuccess?.();
  }

  const canUseSavings = savingsAccounts.length > 0;
  const submitDisabled = pending || !canUseSavings;

  return (
    <form action={disburse} className="entity-form compact-mapping">
      <fieldset>
        <legend>Loan payout</legend>
        {canUseSavings ? (
          <label>
            Client&apos;s savings account
            <select defaultValue={defaultSavingsAccountId} name="savingsAccountId" required>
              {savingsAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.accountNumber}
                  {account.productName ? ` · ${account.productName}` : ""}
                  {account.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <aside className="configuration-note">
            <strong>Savings account required</strong>
            <span>
              The borrower needs an active savings account before this loan can be disbursed —
              disbursement always credits the borrower&apos;s savings account, net of fees.
            </span>
          </aside>
        )}
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
          <legend>Top up</legend>
          <label className="check-row">
            <input
              checked={payOffPrevious}
              onChange={(event) => setPayOffPrevious(event.target.checked)}
              type="checkbox"
            />
            Pay off a previous loan from these proceeds
          </label>
          {payOffPrevious ? (
            <label>
              Loan to pay off
              <select defaultValue={payoffLoanOptions[0]?.id} name="topUpOfLoanId" required>
                {payoffLoanOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.accountNumber} · outstanding {formatMinor(BigInt(option.outstandingMinor), option.currencyCode)}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Proceeds first pay this loan off in full (or as much as the proceeds cover); the
                client receives whatever remains.
              </span>
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

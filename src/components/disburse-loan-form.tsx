"use client";

import { LoaderCircle, PiggyBank } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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

export function DisburseLoanForm({
  loanId,
  settlementAccounts,
  savingsAccounts = [],
  onSuccess,
}: {
  loanId: string;
  settlementAccounts: SettlementAccountOption[];
  savingsAccounts?: SavingsAccountOption[];
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
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

  async function disburse(formData: FormData) {
    const savingsAccountId = String(formData.get("savingsAccountId") || defaultSavingsAccountId || "");
    const paymentMethodSettlementAccountId = String(formData.get("paymentMethodSettlementAccountId") || "");

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
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Loan could not be disbursed");
      return;
    }
    toast.success("Loan disbursed and repayment schedule created");
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
      <div className="form-actions">
        <button className="invest-button" disabled={submitDisabled}>
          {pending ? <LoaderCircle className="spin" size={18} /> : <PiggyBank size={18} />}{" "}
          Disburse loan
        </button>
      </div>
    </form>
  );
}

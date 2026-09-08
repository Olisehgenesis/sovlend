"use client";

import { Banknote, LoaderCircle, PiggyBank } from "lucide-react";
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
  const [destinationType, setDestinationType] = useState<
    "SETTLEMENT_ACCOUNT" | "SAVINGS_ACCOUNT"
  >(settlementAccounts.length > 0 ? "SETTLEMENT_ACCOUNT" : "SAVINGS_ACCOUNT");
  const defaultSavingsAccountId = useMemo(
    () => savingsAccounts.find((account) => account.isDefault)?.id ?? savingsAccounts[0]?.id ?? "",
    [savingsAccounts],
  );
  // Cash is the most common disbursement source in practice, so pre-select it over
  // whatever bank/mobile-money account happens to be listed first.
  const defaultSettlementAccountId = useMemo(
    () => settlementAccounts.find((account) => account.type === "CASH")?.id ?? settlementAccounts[0]?.id ?? "",
    [settlementAccounts],
  );

  async function disburse(formData: FormData) {
    const selectedDestination =
      String(formData.get("destinationType")) === "SAVINGS_ACCOUNT"
        ? "SAVINGS_ACCOUNT"
        : "SETTLEMENT_ACCOUNT";
    const settlementAccountId = String(formData.get("settlementAccountId") || "");
    const savingsAccountId =
      String(formData.get("savingsAccountId") || defaultSavingsAccountId || "");

    if (selectedDestination === "SETTLEMENT_ACCOUNT" && !settlementAccountId) {
      toast.error("Select the settlement account funding this disbursement");
      return;
    }
    if (selectedDestination === "SAVINGS_ACCOUNT" && !savingsAccountId) {
      toast.error("Select the savings account receiving this disbursement");
      return;
    }

    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/disburse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination:
          selectedDestination === "SETTLEMENT_ACCOUNT"
            ? { type: "SETTLEMENT_ACCOUNT", settlementAccountId }
            : { type: "SAVINGS_ACCOUNT", savingsAccountId },
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

  const canUseSettlement = settlementAccounts.length > 0;
  const canUseSavings = savingsAccounts.length > 0;
  const effectiveDestinationType = canUseSavings ? destinationType : "SETTLEMENT_ACCOUNT";
  const submitDisabled =
    pending ||
    (!canUseSettlement && !canUseSavings) ||
    (effectiveDestinationType === "SETTLEMENT_ACCOUNT" && !canUseSettlement) ||
    (effectiveDestinationType === "SAVINGS_ACCOUNT" && !canUseSavings);

  return (
    <form action={disburse} className="entity-form compact-mapping">
      <fieldset>
        <legend>Disbursement</legend>
        {canUseSavings ? (
          <div className="check-row">
            <label>
              <input
                checked={destinationType === "SETTLEMENT_ACCOUNT"}
                name="destinationType"
                onChange={() => setDestinationType("SETTLEMENT_ACCOUNT")}
                type="radio"
                value="SETTLEMENT_ACCOUNT"
              />{" "}
              Pay out via settlement account
            </label>
            <label>
              <input
                checked={destinationType === "SAVINGS_ACCOUNT"}
                name="destinationType"
                onChange={() => setDestinationType("SAVINGS_ACCOUNT")}
                type="radio"
                value="SAVINGS_ACCOUNT"
              />{" "}
              Credit client's savings account
            </label>
          </div>
        ) : (
          <input name="destinationType" type="hidden" value="SETTLEMENT_ACCOUNT" />
        )}
        {effectiveDestinationType === "SETTLEMENT_ACCOUNT" ? (
          canUseSettlement ? (
            <label>
              Funding account
              <select defaultValue={defaultSettlementAccountId} name="settlementAccountId" required>
                {settlementAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <aside className="configuration-note">
              <strong>Settlement setup required</strong>
              <span>
                Add a cash drawer, bank account, Airtel Money, MTN MoMo, or another account in
                Backoffice → Accounting mappings.
              </span>
            </aside>
          )
        ) : (
          <label>
            Savings account destination
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
        )}
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
          {pending ? (
            <LoaderCircle className="spin" size={18} />
          ) : effectiveDestinationType === "SAVINGS_ACCOUNT" ? (
            <PiggyBank size={18} />
          ) : (
            <Banknote size={18} />
          )}{" "}
          Disburse loan
        </button>
      </div>
    </form>
  );
}

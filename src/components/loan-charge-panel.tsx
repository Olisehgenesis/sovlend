"use client";

import { CheckCircle2, LoaderCircle, Plus, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/ui/data-table";
import { BrandActionButton } from "@/components/ui/brand-action-button";
import { formatMinor } from "@/modules/money/domain/format-minor";

type LoanCharge = Readonly<{
  id: string;
  name: string;
  amountMinor: string;
  currencyCode: string;
  status: string;
  dueOnFormatted: string | null;
}>;

type ChargeDefinition = Readonly<{
  id: string;
  name: string;
  calculationType: string;
  amountMinor: string | null;
  percentageBps: number | null;
  currencyCode: string;
  penalty: boolean;
}>;

const CUSTOM_CHARGE_VALUE = "custom";

export function LoanChargesPanel({
  loanId,
  canManage,
  charges,
  chargeDefinitions = [],
  principalMinor = "0",
}: {
  loanId: string;
  canManage: boolean;
  charges: readonly LoanCharge[];
  chargeDefinitions?: readonly ChargeDefinition[];
  principalMinor?: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string>(chargeDefinitions[0]?.id ?? CUSTOM_CHARGE_VALUE);
  const [amountOverride, setAmountOverride] = useState("");

  const selectedDefinition = useMemo(
    () => chargeDefinitions.find((definition) => definition.id === selectedDefinitionId) ?? null,
    [chargeDefinitions, selectedDefinitionId],
  );
  // Server derives the real amount from the definition on submit (including percentage-of-principal
  // math); this is only a live preview so the operator sees what will be charged before posting.
  const prefilledAmountMinor = selectedDefinition
    ? selectedDefinition.calculationType === "PERCENTAGE"
      ? (BigInt(principalMinor) * BigInt(selectedDefinition.percentageBps ?? 0)) / 10_000n
      : BigInt(selectedDefinition.amountMinor ?? "0")
    : 0n;

  async function setStatus(chargeId: string, status: "PAID" | "WAIVED") {
    const confirmed = window.confirm(
      status === "PAID"
        ? "Mark this loan charge as paid? Use this only when the amount has already been collected."
        : "Waive this loan charge? The amount will no longer be due on this loan.",
    );
    if (!confirmed) return;
    setPendingId(`${chargeId}:${status}`);
    const response = await fetch(`/api/loans/${loanId}/charges/${chargeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const result = await response.json().catch(() => ({}));
    setPendingId(null);
    if (!response.ok) {
      toast.error(result.error ?? (status === "PAID" ? "Could not mark this loan charge as paid" : "Could not waive this loan charge"));
      return;
    }
    toast.success(status === "PAID" ? "Loan charge marked as paid" : "Loan charge waived");
    router.refresh();
  }

  async function createCharge(formData: FormData) {
    setPendingCreate(true);
    const isCustom = selectedDefinitionId === CUSTOM_CHARGE_VALUE;
    const response = await fetch(`/api/loans/${loanId}/charges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chargeDefinitionId: isCustom ? undefined : selectedDefinitionId,
        name: isCustom ? formData.get("name") : undefined,
        amount: isCustom ? formData.get("amount") : amountOverride || undefined,
        dueOn: formData.get("dueOn") || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPendingCreate(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not add this loan charge");
      return;
    }
    toast.success("Charge added to the loan account");
    setAmountOverride("");
    router.refresh();
  }

  return (
    <>
      <DataTable
        columns={[
          { key: "charge", header: "Charge", render: (charge) => <strong>{charge.name}</strong> },
          {
            key: "amount",
            header: "Amount",
            cellClassName: "mono",
            render: (charge) => formatMinor(BigInt(charge.amountMinor), charge.currencyCode),
          },
          { key: "due", header: "Due", render: (charge) => charge.dueOnFormatted ?? "-" },
          {
            key: "status",
            header: "Status",
            render: (charge) => (
              <span className={`status ${charge.status === "PAID" ? "up-to-date" : charge.status === "WAIVED" ? "review" : "in-arrears"}`}>
                {charge.status}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            render: (charge) => (
              <div style={{ position: "relative", zIndex: 1 }}>
                {canManage && charge.status === "PENDING" ? (
                  <div className="account-card-actions">
                    <button className="icon-action" disabled={pendingId?.startsWith(`${charge.id}:`) ?? false} onClick={() => setStatus(charge.id, "PAID")} title="Mark paid" type="button">
                      {pendingId === `${charge.id}:PAID` ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}
                    </button>
                    <button className="icon-action" disabled={pendingId?.startsWith(`${charge.id}:`) ?? false} onClick={() => setStatus(charge.id, "WAIVED")} title="Waive" type="button">
                      {pendingId === `${charge.id}:WAIVED` ? <LoaderCircle className="spin" size={14} /> : <XCircle size={14} />}
                    </button>
                  </div>
                ) : null}
              </div>
            ),
          },
        ]}
        emptyState={
          <div className="empty-state compact-empty">
            <strong>No charges recorded</strong>
            <p>Charges raised during approval or servicing will appear here. Use the form below to post a one-off charge.</p>
          </div>
        }
        getRowAriaLabel={(charge) => `Open charge ${charge.name}`}
        getRowKey={(charge) => charge.id}
        rowHref={(charge) => `/loans/${loanId}/charges/${charge.id}`}
        rows={charges}
      />
      {canManage ? (
        <form action={createCharge} className="entity-form compact-mapping">
          <fieldset>
            <legend>Add loan charge</legend>
            <div className="form-row three">
              <label>
                Charge type
                <select onChange={(event) => setSelectedDefinitionId(event.target.value)} value={selectedDefinitionId}>
                  {chargeDefinitions.map((definition) => (
                    <option key={definition.id} value={definition.id}>
                      {definition.name}
                      {definition.penalty ? " (penalty)" : ""} ·{" "}
                      {definition.calculationType === "PERCENTAGE"
                        ? `${((definition.percentageBps ?? 0) / 100).toFixed(2)}%`
                        : formatMinor(BigInt(definition.amountMinor ?? "0"), definition.currencyCode)}
                    </option>
                  ))}
                  <option value={CUSTOM_CHARGE_VALUE}>Custom charge…</option>
                </select>
              </label>
              {selectedDefinition ? (
                <label>
                  Amount ({selectedDefinition.currencyCode})
                  <input
                    onChange={(event) => setAmountOverride(event.target.value)}
                    placeholder={(Number(prefilledAmountMinor) / 100).toString()}
                    step="0.01"
                    type="number"
                    value={amountOverride}
                  />
                </label>
              ) : (
                <>
                  <label>
                    Name
                    <input name="name" placeholder="Processing fee" required />
                  </label>
                  <label>
                    Amount (UGX)
                    <input min={1} name="amount" required step="0.01" type="number" />
                  </label>
                </>
              )}
              <label>
                Due date
                <input name="dueOn" type="date" />
              </label>
            </div>
            {selectedDefinition ? (
              <p className="field-hint">
                Prefilled from the charge catalog: {formatMinor(prefilledAmountMinor, selectedDefinition.currencyCode)}
                {amountOverride ? ` (overridden to ${amountOverride})` : ""}. Manage the catalog under Backoffice → Products → Charges.
              </p>
            ) : null}
          </fieldset>
          <div className="form-actions">
            <BrandActionButton disabled={pendingCreate} icon={pendingCreate ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">
              Add charge
            </BrandActionButton>
          </div>
        </form>
      ) : null}
    </>
  );
}

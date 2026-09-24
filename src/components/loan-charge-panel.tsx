"use client";

import { CheckCircle2, LoaderCircle, Plus, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DataTable } from "@/components/ui/data-table";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";
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
  const dialogRef = useRef<DialogHandle>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [selectedDefinitionIds, setSelectedDefinitionIds] = useState<Set<string>>(new Set());
  const [formVersion, setFormVersion] = useState(0);

  function definitionAmountMinor(definition: ChargeDefinition) {
    return definition.calculationType === "PERCENTAGE"
      ? (BigInt(principalMinor) * BigInt(definition.percentageBps ?? 0)) / 10_000n
      : BigInt(definition.amountMinor ?? "0");
  }

  function definitionAmountLabel(definition: ChargeDefinition) {
    if (definition.calculationType === "PERCENTAGE") {
      return `${((definition.percentageBps ?? 0) / 100).toFixed(2)}% · ${formatMinor(definitionAmountMinor(definition), definition.currencyCode)}`;
    }
    return formatMinor(definitionAmountMinor(definition), definition.currencyCode);
  }

  function toggleDefinition(id: string) {
    setSelectedDefinitionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetDialog() {
    setSelectedDefinitionIds(new Set());
    setFormVersion((current) => current + 1);
  }

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

  async function createCharges(formData: FormData) {
    const extraName = String(formData.get("name") ?? "").trim();
    const extraAmount = String(formData.get("amount") ?? "").trim();
    const dueOn = String(formData.get("dueOn") ?? "").trim() || undefined;
    const definitionIds = [...selectedDefinitionIds];
    if (definitionIds.length === 0 && !extraName) {
      toast.error("Choose a catalog charge, or enter an extra name and amount");
      return;
    }
    if (extraName ? !extraAmount : Boolean(extraAmount)) {
      toast.error("An extra charge needs both a name and an amount");
      return;
    }

    setPendingCreate(true);
    const posts: Array<Record<string, unknown>> = definitionIds.map((chargeDefinitionId) => ({
      chargeDefinitionId,
      dueOn,
    }));
    if (extraName && extraAmount) {
      posts.push({ name: extraName, amount: extraAmount, dueOn });
    }

    let created = 0;
    for (const body of posts) {
      const response = await fetch(`/api/loans/${loanId}/charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPendingCreate(false);
        toast.error(result.error ?? "Could not add this loan charge");
        return;
      }
      created += 1;
    }
    setPendingCreate(false);
    toast.success(created === 1 ? "Charge added to the loan account" : `${created} charges added to the loan account`);
    resetDialog();
    dialogRef.current?.close();
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
            <p>Charges taken at disbursement and any fees you add will appear here.</p>
          </div>
        }
        getRowAriaLabel={(charge) => `Open charge ${charge.name}`}
        getRowKey={(charge) => charge.id}
        rowHref={(charge) => `/loans/${loanId}/charges/${charge.id}`}
        rows={charges}
      />
      {canManage ? (
        <>
          <div className="form-actions">
            <BrandActionButton icon={<Plus size={16} />} onClick={() => dialogRef.current?.showModal()} type="button">
              Add charge
            </BrandActionButton>
          </div>
          <Dialog onClose={resetDialog} ref={dialogRef} title="Add loan charge">
            <form action={createCharges} className="entity-form compact-mapping" key={formVersion}>
              <fieldset>
                <legend>Add loan charge</legend>
                {chargeDefinitions.length === 0 ? (
                  <p className="field-help">No catalog charges yet. Add an extra charge below, or create templates under Backoffice → Products → Charges.</p>
                ) : (
                  <div className="check-list">
                    {chargeDefinitions.map((definition) => (
                      <label className="check-row" key={definition.id}>
                        <input
                          checked={selectedDefinitionIds.has(definition.id)}
                          onChange={() => toggleDefinition(definition.id)}
                          type="checkbox"
                        />
                        {definition.name}
                        {definition.penalty ? " (penalty)" : ""}
                        {" · "}
                        {definitionAmountLabel(definition)}
                      </label>
                    ))}
                  </div>
                )}
                <p className="field-help">Extra charge (optional)</p>
                <div className="form-row">
                  <label>
                    Name
                    <input name="name" placeholder="Processing fee" />
                  </label>
                  <label>
                    Amount (UGX)
                    <input min={0.01} name="amount" step="0.01" type="number" />
                  </label>
                </div>
                <label>
                  Due date
                  <input name="dueOn" type="date" />
                </label>
                <p className="field-hint">Leave the due date empty to take the charge at disbursement when the loan is still approved.</p>
              </fieldset>
              <div className="form-actions">
                <BrandActionButton disabled={pendingCreate} icon={pendingCreate ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">
                  Add charge
                </BrandActionButton>
              </div>
            </form>
          </Dialog>
        </>
      ) : null}
    </>
  );
}

"use client";

import { CheckCircle2, LoaderCircle, Plus, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { formatMinor } from "@/modules/money/domain/format-minor";

type LoanCharge = Readonly<{
  id: string;
  name: string;
  amountMinor: string;
  currencyCode: string;
  status: string;
  dueOnFormatted: string | null;
}>;

export function LoanChargesPanel({
  loanId,
  canManage,
  charges,
}: {
  loanId: string;
  canManage: boolean;
  charges: readonly LoanCharge[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);

  async function setStatus(chargeId: string, status: "PAID" | "WAIVED") {
    setPendingId(chargeId);
    const response = await fetch(`/api/loans/${loanId}/charges/${chargeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const result = await response.json().catch(() => ({}));
    setPendingId(null);
    if (!response.ok) {
      toast.error(result.error ?? "Update failed");
      return;
    }
    toast.success("Charge updated");
    router.refresh();
  }

  async function createCharge(formData: FormData) {
    setPendingCreate(true);
    const response = await fetch(`/api/loans/${loanId}/charges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        amount: formData.get("amount"),
        dueOn: formData.get("dueOn") || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPendingCreate(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not add charge");
      return;
    }
    toast.success("Charge added");
    router.refresh();
  }

  return (
    <>
      {charges.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No charges recorded</strong>
          <p>Add a charge below.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Charge</th>
                <th>Amount</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {charges.map((charge) => (
                <tr key={charge.id}>
                  <td>{charge.name}</td>
                  <td className="mono">{formatMinor(BigInt(charge.amountMinor), charge.currencyCode)}</td>
                  <td>{charge.dueOnFormatted ?? "-"}</td>
                  <td>
                    <span className={`status ${charge.status === "PAID" ? "up-to-date" : charge.status === "WAIVED" ? "review" : "in-arrears"}`}>
                      {charge.status}
                    </span>
                  </td>
                  <td>
                    {canManage && charge.status === "PENDING" ? (
                      <div className="account-card-actions">
                        <button className="icon-action" disabled={pendingId === charge.id} onClick={() => setStatus(charge.id, "PAID")} title="Mark paid" type="button">
                          {pendingId === charge.id ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}
                        </button>
                        <button className="icon-action" disabled={pendingId === charge.id} onClick={() => setStatus(charge.id, "WAIVED")} title="Waive" type="button">
                          <XCircle size={14} />
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <form action={createCharge} className="entity-form compact-mapping">
          <fieldset>
            <legend>Add loan charge</legend>
            <div className="form-row three">
              <label>
                Name
                <input name="name" placeholder="Processing fee" required />
              </label>
              <label>
                Amount (UGX)
                <input min={1} name="amount" required step="0.01" type="number" />
              </label>
              <label>
                Due date
                <input name="dueOn" type="date" />
              </label>
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" disabled={pendingCreate}>
              {pendingCreate ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add charge
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

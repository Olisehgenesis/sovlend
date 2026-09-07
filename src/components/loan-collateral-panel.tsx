"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { formatMinor } from "@/modules/money/domain/format-minor";

type CollateralItem = Readonly<{
  id: string;
  type: string;
  description: string | null;
  estimatedValueMinor: string | null;
  valuationCurrencyCode: string;
  valuationDateLabel: string | null;
  status: string;
}>;

export function LoanCollateralPanel({ loanId, canManage, items }: { loanId: string; canManage: boolean; items: readonly CollateralItem[] }) {
  const router = useRouter();
  const [pendingCreate, setPendingCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function createCollateral(formData: FormData) {
    setPendingCreate(true);
    const response = await fetch(`/api/loans/${loanId}/collateral`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: formData.get("type"),
        description: formData.get("description") || undefined,
        estimatedValue: formData.get("estimatedValue") || undefined,
        valuationDate: formData.get("valuationDate") || undefined,
        status: formData.get("status") || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPendingCreate(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not add collateral");
      return;
    }
    toast.success("Collateral added");
    router.refresh();
  }

  async function removeCollateral(collateralId: string) {
    setPendingDelete(collateralId);
    const response = await fetch(`/api/loans/${loanId}/collateral/${collateralId}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    setPendingDelete(null);
    if (!response.ok) {
      toast.error(result.error ?? "Could not remove collateral");
      return;
    }
    toast.success("Collateral removed");
    router.refresh();
  }

  return (
    <>
      {items.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No collateral recorded</strong>
          <p>Add pledged assets for this loan below.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="clickable-rows">
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Estimated value</th>
                <th>Valuation date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.type}</strong>
                    <Link className="row-link" href={`/loans/${loanId}/collateral/${item.id}`} aria-label={`Open collateral ${item.type}`} />
                  </td>
                  <td>{item.description ?? "-"}</td>
                  <td className="mono">
                    {item.estimatedValueMinor ? formatMinor(BigInt(item.estimatedValueMinor), item.valuationCurrencyCode) : "-"}
                  </td>
                  <td>{item.valuationDateLabel ?? "-"}</td>
                  <td>
                    <span className={`status ${item.status === "ACTIVE" ? "up-to-date" : "review"}`}>{item.status}</span>
                  </td>
                  <td style={{ position: "relative", zIndex: 1 }}>
                    {canManage ? (
                      <button className="icon-action danger" disabled={pendingDelete === item.id} onClick={() => removeCollateral(item.id)} title="Remove collateral" type="button">
                        {pendingDelete === item.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <form action={createCollateral} className="entity-form compact-mapping">
          <fieldset>
            <legend>Add collateral</legend>
            <div className="form-row three">
              <label>
                Type
                <input name="type" placeholder="Land title, Vehicle, Equipment" required />
              </label>
              <label>
                Estimated value (UGX)
                <input min={1} name="estimatedValue" step="0.01" type="number" />
              </label>
              <label>
                Status
                <select defaultValue="ACTIVE" name="status">
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="RELEASED">RELEASED</option>
                  <option value="DISPOSED">DISPOSED</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Valuation date
                <input name="valuationDate" type="date" />
              </label>
              <label>
                Description
                <input name="description" placeholder="Asset details and reference" />
              </label>
            </div>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" disabled={pendingCreate}>
              {pendingCreate ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add collateral
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

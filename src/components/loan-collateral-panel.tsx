"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AttachedItemForm } from "@/components/ui/attached-item-form";
import { DataTable } from "@/components/ui/data-table";
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
      toast.error(result.error ?? "Could not add this collateral item");
      return;
    }
    toast.success("Collateral added to the loan record");
    router.refresh();
  }

  async function removeCollateral(collateralId: string) {
    if (!window.confirm("Remove this collateral item from the loan record? Do this only if it was added by mistake or is no longer tied to the loan.")) return;
    setPendingDelete(collateralId);
    const response = await fetch(`/api/loans/${loanId}/collateral/${collateralId}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    setPendingDelete(null);
    if (!response.ok) {
      toast.error(result.error ?? "Could not remove this collateral item");
      return;
    }
    toast.success("Collateral removed from the loan record");
    router.refresh();
  }

  return (
    <>
      <DataTable
        columns={[
          { key: "type", header: "Type", render: (item) => <strong>{item.type}</strong> },
          { key: "description", header: "Description", render: (item) => item.description ?? "-" },
          {
            key: "estimatedValue",
            header: "Estimated value",
            cellClassName: "mono",
            render: (item) => (item.estimatedValueMinor ? formatMinor(BigInt(item.estimatedValueMinor), item.valuationCurrencyCode) : "-"),
          },
          { key: "valuationDate", header: "Valuation date", render: (item) => item.valuationDateLabel ?? "-" },
          {
            key: "status",
            header: "Status",
            render: (item) => <span className={`status ${item.status === "ACTIVE" ? "up-to-date" : "review"}`}>{item.status}</span>,
          },
          {
            key: "actions",
            header: "",
            render: (item) => (
              <div style={{ position: "relative", zIndex: 1 }}>
                {canManage ? (
                  <button className="icon-action danger" disabled={pendingDelete === item.id} onClick={() => removeCollateral(item.id)} title="Remove collateral" type="button">
                    {pendingDelete === item.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        emptyState={
          <div className="empty-state compact-empty">
            <strong>No collateral recorded</strong>
            <p>Add pledged assets for this loan below.</p>
          </div>
        }
        getRowAriaLabel={(item) => `Open collateral ${item.type}`}
        getRowKey={(item) => item.id}
        rowHref={(item) => `/loans/${loanId}/collateral/${item.id}`}
        rows={items}
      />
      {canManage ? (
        <AttachedItemForm
          action={createCollateral}
          fieldRows={[
            [
              { type: "text", name: "type", label: "Type", placeholder: "Land title, Vehicle, Equipment", required: true },
              { type: "number", name: "estimatedValue", label: "Estimated value (UGX)", min: 1, step: "0.01" },
              { type: "select", name: "status", label: "Status", options: ["ACTIVE", "RELEASED", "DISPOSED"], defaultValue: "ACTIVE" },
            ],
            [
              { type: "date", name: "valuationDate", label: "Valuation date" },
              { type: "text", name: "description", label: "Description", placeholder: "Asset details and reference" },
            ],
          ]}
          legend="Add collateral"
          pending={pendingCreate}
          submitLabel="Add collateral"
        />
      ) : null}
    </>
  );
}

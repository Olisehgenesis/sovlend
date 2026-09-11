"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AttachedItemForm } from "@/components/ui/attached-item-form";
import { DataTable } from "@/components/ui/data-table";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { satsToUgxMinor } from "@/modules/btc/domain/valuation";

type BtcAccount = Readonly<{
  id: string;
  label: string;
  balanceSource: string;
  address: string | null;
  status: string;
  balanceSats: string;
  balanceUnavailable: boolean;
  balanceAsOf: string | null;
}>;

// Phase 1 is read-only custody (docs/btc-integration-plan.md §7): this panel only ever displays
// balances and lets staff record what a client has told them (or what a public address already
// shows) -- it never initiates a BTC transfer.
export function ClientBtcAccountsPanel({ clientId, canManage, accounts, btcPriceUgx }: { clientId: string; canManage: boolean; accounts: readonly BtcAccount[]; btcPriceUgx: number | null }) {
  const router = useRouter();
  const [pendingCreate, setPendingCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function createAccount(formData: FormData) {
    setPendingCreate(true);
    const response = await fetch(`/api/clients/${clientId}/btc-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: formData.get("label"),
        balanceSource: formData.get("balanceSource"),
        address: formData.get("address") || undefined,
        manualBalanceSats: formData.get("manualBalanceSats") || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPendingCreate(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not add this BTC account");
      return;
    }
    toast.success("BTC account added to the client record");
    router.refresh();
  }

  async function removeAccount(accountId: string) {
    if (!window.confirm("Remove this BTC account from the client record? This does not move or affect any real funds -- it only removes the record SovLend keeps of it.")) return;
    setPendingDelete(accountId);
    const response = await fetch(`/api/clients/${clientId}/btc-accounts/${accountId}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    setPendingDelete(null);
    if (!response.ok) {
      toast.error(result.error ?? "Could not remove this BTC account");
      return;
    }
    toast.success("BTC account removed");
    router.refresh();
  }

  return (
    <>
      <DataTable
        columns={[
          { key: "label", header: "Label", render: (item) => <strong>{item.label}</strong> },
          {
            key: "source",
            header: "Source",
            render: (item) => (item.balanceSource === "ON_CHAIN_ADDRESS" ? <span className="mono">{item.address}</span> : "Manually recorded"),
          },
          {
            key: "balance",
            header: "Balance",
            cellClassName: "mono",
            render: (item) => (item.balanceUnavailable ? <span className="muted-text">Unavailable right now</span> : formatMinor(BigInt(item.balanceSats), "BTC")),
          },
          {
            key: "localValue",
            header: "Local equivalent",
            cellClassName: "mono",
            render: (item) => {
              if (item.balanceUnavailable) return "\u2014";
              const ugxMinor = satsToUgxMinor(BigInt(item.balanceSats), btcPriceUgx);
              return ugxMinor === null ? <span className="muted-text">Price unavailable</span> : formatMinor(ugxMinor, "UGX");
            },
          },
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
                  <button className="icon-action danger" disabled={pendingDelete === item.id} onClick={() => removeAccount(item.id)} title="Remove BTC account" type="button">
                    {pendingDelete === item.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        emptyState={
          <div className="empty-state compact-empty">
            <strong>No BTC accounts recorded</strong>
            <p>Read-only Phase 1: add a client&apos;s BTC address or a manually recorded balance below. SovLend holds no keys and moves no funds here.</p>
          </div>
        }
        getRowKey={(item) => item.id}
        rows={accounts}
      />
      {canManage ? (
        <AttachedItemForm
          action={createAccount}
          fieldRows={[
            [
              { type: "text", name: "label", label: "Label", placeholder: "Blink wallet, cold storage, savings", required: true },
              { type: "select", name: "balanceSource", label: "Balance source", options: ["MANUAL", "ON_CHAIN_ADDRESS"], defaultValue: "MANUAL" },
            ],
            [
              { type: "text", name: "address", label: "On-chain address (if applicable)", placeholder: "bc1q..." },
              { type: "number", name: "manualBalanceSats", label: "Manually recorded balance (sats)", min: 0, defaultValue: "0" },
            ],
          ]}
          legend="Add BTC account"
          pending={pendingCreate}
          submitLabel="Add BTC account"
        />
      ) : null}
    </>
  );
}

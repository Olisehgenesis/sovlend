"use client";

import { CheckCircle2, LoaderCircle, Minus, Plus, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function DepositWithdrawForm({ clientId, savingsAccountId }: { clientId: string; savingsAccountId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<"DEPOSIT" | "WITHDRAWAL" | null>(null);

  async function transact(type: "DEPOSIT" | "WITHDRAWAL") {
    if (!amount || Number(amount) <= 0) { toast.error("Enter an amount"); return; }
    setPending(type);
    const response = await fetch(`/api/clients/${clientId}/savings-accounts/${savingsAccountId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amount }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { toast.error(result.error ?? "Transaction failed"); return; }
    toast.success(type === "DEPOSIT" ? "Deposit recorded" : "Withdrawal recorded");
    setAmount("");
    router.refresh();
  }

  return (
    <div className="account-card-form">
      <label>Amount (UGX)<input inputMode="decimal" min={1} onChange={(event) => setAmount(event.target.value)} step="0.01" type="number" value={amount} /></label>
      <div className="account-card-actions">
        <button className="invest-button" disabled={pending !== null} onClick={() => transact("DEPOSIT")} type="button">{pending === "DEPOSIT" ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Deposit</button>
        <button className="secondary-action" disabled={pending !== null} onClick={() => transact("WITHDRAWAL")} type="button">{pending === "WITHDRAWAL" ? <LoaderCircle className="spin" size={15} /> : <Minus size={15} />} Withdraw</button>
      </div>
    </div>
  );
}

export function ApproveSavingsAccountButton({ clientId, savingsAccountId }: { clientId: string; savingsAccountId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function approve() {
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/savings-accounts/${savingsAccountId}/approve`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not approve"); return; }
    toast.success("Savings account approved");
    router.refresh();
  }

  return <button className="icon-action" disabled={pending} onClick={approve} title="Approve" type="button">{pending ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}</button>;
}

export function ApplyForLoanButton({ clientId }: { clientId: string }) {
  return <a className="invest-button" href={`/loans/new?clientId=${clientId}`}><Plus size={16} /> Add loan</a>;
}

export type ChargeRow = Readonly<{ id: string; name: string; amountFormatted: string; status: string; dueOnFormatted: string | null }>;

export function ChargesList({ clientId, charges, canManage }: { clientId: string; charges: readonly ChargeRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function setStatus(chargeId: string, status: "PAID" | "WAIVED") {
    setPendingId(chargeId);
    const response = await fetch(`/api/clients/${clientId}/charges/${chargeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json().catch(() => ({}));
    setPendingId(null);
    if (!response.ok) { toast.error(result.error ?? "Update failed"); return; }
    toast.success("Charge updated");
    router.refresh();
  }

  if (charges.length === 0) return <div className="empty-state compact-empty"><strong>No charges recorded</strong><p>Add a charge below.</p></div>;

  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Charge</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {charges.map((charge) => (
            <tr key={charge.id}>
              <td>{charge.name}</td>
              <td className="mono">{charge.amountFormatted}</td>
              <td>{charge.dueOnFormatted ?? "\u2014"}</td>
              <td><span className={`status ${charge.status === "PAID" ? "up-to-date" : charge.status === "WAIVED" ? "review" : "in-arrears"}`}>{charge.status}</span></td>
              <td>{canManage && charge.status === "PENDING" ? (
                <div className="account-card-actions">
                  <button className="icon-action" disabled={pendingId === charge.id} onClick={() => setStatus(charge.id, "PAID")} title="Mark paid" type="button"><CheckCircle2 size={15} /></button>
                  <button className="icon-action" disabled={pendingId === charge.id} onClick={() => setStatus(charge.id, "WAIVED")} title="Waive" type="button"><XCircle size={15} /></button>
                </div>
              ) : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AddChargeForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/charges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formData.get("name"), amount: formData.get("amount"), dueOn: formData.get("dueOn") || undefined }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not add charge"); return; }
    toast.success("Charge added");
    router.refresh();
  }

  return <form action={submit} className="entity-form compact-mapping">
    <fieldset><legend>Add charge</legend><div className="form-row three"><label>Name<input name="name" placeholder="Processing fee" required /></label><label>Amount (UGX)<input min={1} name="amount" required step="0.01" type="number" /></label><label>Due date<input name="dueOn" type="date" /></label></div></fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add charge</button></div>
  </form>;
}

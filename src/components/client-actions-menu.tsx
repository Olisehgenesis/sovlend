"use client";

import { Ban, ChevronDown, Coins, Edit3, LoaderCircle, Signature, ShieldOff, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type ClientActionsMenuProps = Readonly<{
  clientId: string;
  accountNumber: string;
  status: string;
  hasOfficer: boolean;
  hasSignature: boolean;
  canManage: boolean;
  canTransact: boolean;
  officers: ReadonlyArray<{ id: string; name: string }>;
}>;

export function ClientActionsMenu({ clientId, accountNumber, status, hasOfficer, hasSignature, canManage, canTransact, officers }: ClientActionsMenuProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function post(
    action: string,
    url: string,
    options?: { body?: unknown; confirmMessage?: string; successMessage?: string; errorMessage?: string },
  ) {
    if (options?.confirmMessage && !window.confirm(options.confirmMessage)) return;
    setPendingAction(action);
    const response = await fetch(url, options?.body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) } : { method: "POST" });
    const result = await response.json().catch(() => ({}));
    setPendingAction(null);
    if (!response.ok) { toast.error(result.error ?? options?.errorMessage ?? "Could not complete this client action"); return; }
    toast.success(options?.successMessage ?? "Client action completed");
    router.refresh();
  }

  async function assignStaff(formData: FormData) {
    const officerId = String(formData.get("officerId") || "");
    if (!officerId) { toast.error("Choose a staff member"); return; }
    await post("assign-staff", `/api/clients/${clientId}/assign-staff`, {
      body: { officerId },
      errorMessage: "Could not assign staff to this client",
      successMessage: `Staff assigned to client ${accountNumber}`,
    });
  }

  async function uploadSignature(formData: FormData) {
    const file = formData.get("signature");
    if (!(file instanceof File) || file.size === 0) { toast.error("Choose a signature file"); return; }
    const body = new FormData();
    body.set("name", "Client signature");
    body.set("setAsSignature", "on");
    body.set("file", file);
    setPendingAction("signature");
    const response = await fetch(`/api/clients/${clientId}/documents`, { method: "POST", body });
    const result = await response.json().catch(() => ({}));
    setPendingAction(null);
    if (!response.ok) { toast.error(result.error ?? "Could not upload the client signature"); return; }
    toast.success("Signature uploaded to the client record");
    router.refresh();
  }

  return (
    <nav className="client-actions" aria-label="Client actions">
      {canManage ? <Link className="client-action" href={`/clients/${accountNumber}/edit`}><Edit3 size={15} /> Edit</Link> : null}
      {canManage ? <Link className="client-action" href={`/clients/${accountNumber}?tab=charges`}><Coins size={15} /> Add charge</Link> : null}
      {canManage ? <Link className="client-action" href={`/clients/${accountNumber}/transfer`}><ShieldOff size={15} /> Transfer client</Link> : null}
      {canManage && officers.length > 0 ? (
        <form action={assignStaff} className="client-action-assign-staff">
          <label><UserRound size={15} /><select name="officerId" defaultValue="">
            <option disabled value="">{hasOfficer ? "Reassign staff" : "Assign staff"}</option>
            {officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.name}</option>)}
          </select></label>
          <button className="client-action" disabled={pendingAction === "assign-staff"} type="submit">
            {pendingAction === "assign-staff" ? <LoaderCircle className="spin" size={15} /> : null}
            Assign
          </button>
        </form>
      ) : null}
      {canManage && hasOfficer ? <button className="client-action" disabled={pendingAction === "unassign"} onClick={() => post("unassign", `/api/clients/${clientId}/unassign-staff`, { confirmMessage: "Unassign the loan officer from this client?", errorMessage: "Could not unassign staff from this client", successMessage: "Staff unassigned from client" })} type="button">{pendingAction === "unassign" ? <LoaderCircle className="spin" size={15} /> : <ShieldOff size={15} />} Unassign staff</button> : null}
      {canManage && status !== "CLOSED" ? <button className="client-action danger" disabled={pendingAction === "close"} onClick={() => post("close", `/api/clients/${clientId}/close`, { confirmMessage: "Close this client? This cannot be undone from here.", errorMessage: "Could not close this client record", successMessage: `Client ${accountNumber} closed` })} type="button">{pendingAction === "close" ? <LoaderCircle className="spin" size={15} /> : <Ban size={15} />} Close client</button> : null}

      {canTransact && status === "ACTIVE" ? (
        <details className="client-action-more">
          <summary>More <ChevronDown size={13} /></summary>
          <div className="client-action-more-body">
            <button className="client-action" disabled={pendingAction === "share"} onClick={() => post("share", `/api/clients/${clientId}/savings-accounts`, { body: { accountType: "SHARE" }, errorMessage: "Could not request a new share account", successMessage: "Share account request submitted for approval" })} type="button">{pendingAction === "share" ? <LoaderCircle className="spin" size={15} /> : <Coins size={15} />} New share account</button>
            <button className="client-action" disabled={pendingAction === "fixed"} onClick={() => post("fixed", `/api/clients/${clientId}/savings-accounts`, { body: { accountType: "FIXED_DEPOSIT" }, errorMessage: "Could not request a fixed deposit account", successMessage: "Fixed deposit account request submitted for approval" })} type="button">{pendingAction === "fixed" ? <LoaderCircle className="spin" size={15} /> : <Coins size={15} />} New fixed deposit</button>
            <button className="client-action" disabled={pendingAction === "recurring"} onClick={() => post("recurring", `/api/clients/${clientId}/savings-accounts`, { body: { accountType: "RECURRING_DEPOSIT" }, errorMessage: "Could not request a recurring deposit account", successMessage: "Recurring deposit account request submitted for approval" })} type="button">{pendingAction === "recurring" ? <LoaderCircle className="spin" size={15} /> : <Coins size={15} />} New recurring deposit</button>
            {canManage ? (
              <form action={uploadSignature} className="client-signature-form">
                <label><Signature size={14} /> Upload signature<input accept="image/*" name="signature" required type="file" /></label>
                <button className="client-action" disabled={pendingAction === "signature"} type="submit">
                  {pendingAction === "signature" ? <LoaderCircle className="spin" size={15} /> : null}
                  Upload
                </button>
              </form>
            ) : null}
            {canManage && hasSignature ? <button className="client-action danger" disabled={pendingAction === "delete-signature"} onClick={() => post("delete-signature", `/api/clients/${clientId}/signature`, { confirmMessage: "Remove the signature on file?", errorMessage: "Could not remove the signature on file", successMessage: "Signature removed from the client record" })} type="button">{pendingAction === "delete-signature" ? <LoaderCircle className="spin" size={15} /> : <Signature size={15} />} Delete signature</button> : null}
          </div>
        </details>
      ) : null}
    </nav>
  );
}

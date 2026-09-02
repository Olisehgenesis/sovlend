"use client";

import { Ban, ChevronDown, Coins, Edit3, Signature, ShieldOff } from "lucide-react";
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
}>;

export function ClientActionsMenu({ clientId, accountNumber, status, hasOfficer, hasSignature, canManage, canTransact }: ClientActionsMenuProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function post(action: string, url: string, options?: { body?: unknown; confirmMessage?: string }) {
    if (options?.confirmMessage && !window.confirm(options.confirmMessage)) return;
    setPendingAction(action);
    const response = await fetch(url, options?.body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) } : { method: "POST" });
    const result = await response.json().catch(() => ({}));
    setPendingAction(null);
    if (!response.ok) { toast.error(result.error ?? "Action failed"); return; }
    toast.success("Done");
    router.refresh();
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
    if (!response.ok) { toast.error(result.error ?? "Upload failed"); return; }
    toast.success("Signature uploaded");
    router.refresh();
  }

  return (
    <nav className="client-actions" aria-label="Client actions">
      {canManage ? <Link className="client-action" href={`/clients/${accountNumber}/edit`}><Edit3 size={15} /> Edit</Link> : null}
      {canManage ? <Link className="client-action" href={`/clients/${accountNumber}?tab=charges`}><Coins size={15} /> Add charge</Link> : null}
      {canManage ? <Link className="client-action" href={`/clients/${accountNumber}/transfer`}><ShieldOff size={15} /> Transfer client</Link> : null}
      {canManage && hasOfficer ? <button className="client-action" disabled={pendingAction === "unassign"} onClick={() => post("unassign", `/api/clients/${clientId}/unassign-staff`, { confirmMessage: "Unassign the loan officer from this client?" })} type="button"><ShieldOff size={15} /> Unassign staff</button> : null}
      {canManage && status !== "CLOSED" ? <button className="client-action danger" disabled={pendingAction === "close"} onClick={() => post("close", `/api/clients/${clientId}/close`, { confirmMessage: "Close this client? This cannot be undone from here." })} type="button"><Ban size={15} /> Close client</button> : null}

      {canTransact && status === "ACTIVE" ? (
        <details className="client-action-more">
          <summary>More <ChevronDown size={13} /></summary>
          <div className="client-action-more-body">
            <button className="client-action" disabled={pendingAction === "share"} onClick={() => post("share", `/api/clients/${clientId}/savings-accounts`, { body: { accountType: "SHARE" } })} type="button"><Coins size={15} /> New share account</button>
            <button className="client-action" disabled={pendingAction === "fixed"} onClick={() => post("fixed", `/api/clients/${clientId}/savings-accounts`, { body: { accountType: "FIXED_DEPOSIT" } })} type="button"><Coins size={15} /> New fixed deposit</button>
            <button className="client-action" disabled={pendingAction === "recurring"} onClick={() => post("recurring", `/api/clients/${clientId}/savings-accounts`, { body: { accountType: "RECURRING_DEPOSIT" } })} type="button"><Coins size={15} /> New recurring deposit</button>
            {canManage ? (
              <form action={uploadSignature} className="client-signature-form">
                <label><Signature size={14} /> Upload signature<input accept="image/*" name="signature" required type="file" /></label>
                <button className="client-action" disabled={pendingAction === "signature"} type="submit">Upload</button>
              </form>
            ) : null}
            {canManage && hasSignature ? <button className="client-action danger" disabled={pendingAction === "delete-signature"} onClick={() => post("delete-signature", `/api/clients/${clientId}/signature`, { confirmMessage: "Remove the signature on file?" })} type="button"><Signature size={15} /> Delete signature</button> : null}
          </div>
        </details>
      ) : null}
    </nav>
  );
}


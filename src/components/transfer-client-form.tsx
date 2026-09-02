"use client";

import { ArrowRightLeft, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function TransferClientForm({ clientId, accountNumber, currentOfficeId, offices }: { clientId: string; accountNumber: string; currentOfficeId: string; offices: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function transfer(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId: formData.get("officeId") }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Transfer failed"); return; }
    toast.success("Client transferred");
    router.push(`/clients/${accountNumber}`);
    router.refresh();
  }

  return <form action={transfer} className="entity-form">
    <fieldset><legend>Destination office</legend><label>Office<select defaultValue={currentOfficeId} name="officeId" required>{offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label><p className="muted-text">Transferring a client clears their assigned loan officer.</p></fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <ArrowRightLeft size={18} />} Transfer client</button></div>
  </form>;
}

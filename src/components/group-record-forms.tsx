"use client";

import { LoaderCircle, Plus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

export function AddGroupMemberForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function addMember(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientAccountNumber: formData.get("clientAccountNumber") }) });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not add this client to the group"); return; }
    toast.success("Client added to the group");
    router.refresh();
  }

  return <form action={addMember} className="entity-form compact-mapping"><fieldset><legend>Add member</legend><label>Client account number<input name="clientAccountNumber" placeholder="20260902-000001" required /></label></fieldset><div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />} type="submit">Add member</BrandActionButton></div></form>;
}

export function AddGroupNoteForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function addNote(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/groups/${groupId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: formData.get("body") }) });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not save this group note"); return; }
    toast.success("Note added to the group record");
    router.refresh();
  }

  return <form action={addNote} className="entity-form compact-mapping"><fieldset><legend>Add note</legend><label>Note<textarea name="body" required rows={3} /></label></fieldset><div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">Add note</BrandActionButton></div></form>;
}

export function OpenGroupJournalContributionButton({ groupId, alreadyOpen }: { groupId: string; alreadyOpen: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [chargeCrb, setChargeCrb] = useState(false);

  async function openAccount() {
    setPending(true);
    const response = await fetch(`/api/groups/${groupId}/savings-accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chargeCrb }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not open group journal contribution");
      return;
    }
    toast.success("Group journal contribution requested — awaiting approval");
    router.refresh();
  }

  if (alreadyOpen) return null;

  return (
    <div className="form-actions">
      <label className="check-row">
        <input checked={chargeCrb} onChange={(event) => setChargeCrb(event.target.checked)} type="checkbox" />
        Charge CRB (15,000)
      </label>
      <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} onClick={openAccount} type="button">
        Open group journal contribution
      </BrandActionButton>
    </div>
  );
}

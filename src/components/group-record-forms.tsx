"use client";

import { LoaderCircle, Plus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function AddGroupMemberForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function addMember(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientAccountNumber: formData.get("clientAccountNumber") }) });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not add member"); return; }
    toast.success("Member added");
    router.refresh();
  }

  return <form action={addMember} className="entity-form compact-mapping"><fieldset><legend>Add member</legend><label>Client account number<input name="clientAccountNumber" placeholder="20260902-000001" required /></label></fieldset><div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />} Add member</button></div></form>;
}

export function AddGroupNoteForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function addNote(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/groups/${groupId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: formData.get("body") }) });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not add note"); return; }
    toast.success("Note added");
    router.refresh();
  }

  return <form action={addNote} className="entity-form compact-mapping"><fieldset><legend>Add note</legend><label>Note<textarea name="body" required rows={3} /></label></fieldset><div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add note</button></div></form>;
}

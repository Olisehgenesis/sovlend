"use client";

import { LoaderCircle, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function CreateGroupForm({ offices, staff }: { offices: Array<{ id: string; name: string }>; staff: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function createGroup(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId: formData.get("officeId"),
        externalId: formData.get("externalId") || undefined,
        name: formData.get("name"),
        staffId: formData.get("staffId") || undefined,
        active: formData.get("active") === "on",
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Group could not be created"); return; }
    toast.success(`Group ${result.accountNumber} created`);
    router.push(`/groups/${result.accountNumber}`);
    router.refresh();
  }

  return <form action={createGroup} className="entity-form"><fieldset><legend>Office and identity</legend><label>Office<select name="officeId" required>{offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label><div className="form-row"><label>Name<input name="name" required /></label><label>External ID<input name="externalId" /></label></div><label>Staff<select name="staffId" defaultValue=""><option value="">Unassigned</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><div className="check-row"><label><input name="active" type="checkbox" /> Activate immediately</label></div></fieldset><div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <UsersRound size={18} />} Create group</button></div></form>;
}

"use client";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function CreateClientForm({ offices }: { offices: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function createClient(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId: formData.get("officeId"),
        firstName: formData.get("firstName"),
        middleName: formData.get("middleName") || undefined,
        lastName: formData.get("lastName"),
        mobileNumber: formData.get("mobileNumber") || undefined,
        dateOfBirth: formData.get("dateOfBirth") || undefined,
        genderCode: formData.get("genderCode") || undefined,
        clientTypeCode: formData.get("clientTypeCode") || undefined,
        classificationCode: formData.get("classificationCode") || undefined,
        externalId: formData.get("externalId") || undefined,
        active: formData.get("active") === "on",
        isStaff: formData.get("isStaff") === "on",
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Client could not be created");
      return;
    }
    toast.success(`Client ${result.accountNumber} created`);
    router.push(`/clients/${result.accountNumber}`);
    router.refresh();
  }

  return <form action={createClient} className="entity-form"><fieldset><legend>Office and identity</legend><label>Office<select name="officeId" required>{offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label><div className="form-row three"><label>First name<input name="firstName" required /></label><label>Middle name<input name="middleName" /></label><label>Last name<input name="lastName" required /></label></div><div className="form-row"><label>Mobile number<input name="mobileNumber" inputMode="tel" /></label><label>Date of birth<input name="dateOfBirth" type="date" /></label></div></fieldset><fieldset><legend>Classification</legend><div className="form-row three"><label>Gender<select name="genderCode" defaultValue=""><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label><label>Client type<input name="clientTypeCode" /></label><label>Classification<input name="classificationCode" /></label></div><label>External ID<input name="externalId" /></label><div className="check-row"><label><input name="active" type="checkbox" /> Activate immediately</label><label><input name="isStaff" type="checkbox" /> Client is also staff</label></div></fieldset><div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <UserPlus size={18} />} Create client</button></div></form>;
}
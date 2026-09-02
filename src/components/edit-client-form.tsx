"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type EditableClient = Readonly<{
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  mobileNumber: string | null;
  dateOfBirth: string | null;
  genderCode: string | null;
  clientTypeCode: string | null;
  classificationCode: string | null;
  externalId: string | null;
}>;

export function EditClientForm({ client, accountNumber }: { client: EditableClient; accountNumber: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function save(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: formData.get("firstName"),
        middleName: formData.get("middleName") || undefined,
        lastName: formData.get("lastName"),
        mobileNumber: formData.get("mobileNumber") || undefined,
        dateOfBirth: formData.get("dateOfBirth") || undefined,
        genderCode: formData.get("genderCode") || undefined,
        clientTypeCode: formData.get("clientTypeCode") || undefined,
        classificationCode: formData.get("classificationCode") || undefined,
        externalId: formData.get("externalId") || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Client could not be updated"); return; }
    toast.success("Client updated");
    router.push(`/clients/${accountNumber}`);
    router.refresh();
  }

  return <form action={save} className="entity-form">
    <fieldset><legend>Identity</legend><div className="form-row three"><label>First name<input defaultValue={client.firstName} name="firstName" required /></label><label>Middle name<input defaultValue={client.middleName ?? ""} name="middleName" /></label><label>Last name<input defaultValue={client.lastName} name="lastName" required /></label></div><div className="form-row"><label>Mobile number<input defaultValue={client.mobileNumber ?? ""} inputMode="tel" name="mobileNumber" /></label><label>Date of birth<input defaultValue={client.dateOfBirth ?? ""} name="dateOfBirth" type="date" /></label></div></fieldset>
    <fieldset><legend>Classification</legend><div className="form-row three"><label>Gender<select defaultValue={client.genderCode ?? ""} name="genderCode"><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label><label>Client type<input defaultValue={client.clientTypeCode ?? ""} name="clientTypeCode" /></label><label>Classification<input defaultValue={client.classificationCode ?? ""} name="classificationCode" /></label></div><label>External ID<input defaultValue={client.externalId ?? ""} name="externalId" /></label></fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />} Save changes</button></div>
  </form>;
}

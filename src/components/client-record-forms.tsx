"use client";

import { LoaderCircle, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

function useSubmitJson(url: string, successMessage: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function submit(body: unknown, form?: HTMLFormElement) {
    setPending(true);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Request failed"); return; }
    toast.success(successMessage);
    form?.reset();
    router.refresh();
  }
  return { submit, pending };
}

export function AddFamilyMemberForm({ clientId }: { clientId: string }) {
  const { submit, pending } = useSubmitJson(`/api/clients/${clientId}/family-members`, "Family member added");
  return <form action={(formData) => { const form = document.getElementById(`family-form-${clientId}`) as HTMLFormElement; submit({ firstName: formData.get("firstName"), middleName: formData.get("middleName") || undefined, lastName: formData.get("lastName"), relationship: formData.get("relationship") || undefined, genderCode: formData.get("genderCode") || undefined, mobileNumber: formData.get("mobileNumber") || undefined, age: formData.get("age") ? Number(formData.get("age")) : undefined, isDependent: formData.get("isDependent") === "on" }, form); }} className="entity-form compact-mapping" id={`family-form-${clientId}`}>
    <fieldset><legend>Add family member</legend><div className="form-row three"><label>First name<input name="firstName" required /></label><label>Middle name<input name="middleName" /></label><label>Last name<input name="lastName" required /></label></div><div className="form-row three"><label>Relationship<input name="relationship" placeholder="Spouse, parent, sibling" /></label><label>Gender<select name="genderCode" defaultValue=""><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label><label>Mobile number<input name="mobileNumber" inputMode="tel" /></label></div><div className="form-row"><label>Age<input name="age" type="number" min={0} max={130} /></label><label className="check-row"><input name="isDependent" type="checkbox" /> Is a dependent</label></div></fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add family member</button></div>
  </form>;
}

export function AddIdentifierForm({ clientId }: { clientId: string }) {
  const { submit, pending } = useSubmitJson(`/api/clients/${clientId}/identifiers`, "Identity added");
  return <form action={(formData) => { const form = document.getElementById(`identifier-form-${clientId}`) as HTMLFormElement; submit({ documentType: formData.get("documentType"), status: formData.get("status"), uniqueNumber: formData.get("uniqueNumber"), description: formData.get("description") || undefined }, form); }} className="entity-form compact-mapping" id={`identifier-form-${clientId}`}>
    <fieldset><legend>Add identity</legend><div className="form-row three"><label>Document type<input name="documentType" placeholder="Passport, National ID" required /></label><label>Status<select name="status" defaultValue="ACTIVE"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><label>Unique ID #<input name="uniqueNumber" required /></label></div><label>Description<input name="description" /></label></fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add identity</button></div>
  </form>;
}

export function AddNoteForm({ clientId }: { clientId: string }) {
  const { submit, pending } = useSubmitJson(`/api/clients/${clientId}/notes`, "Note added");
  return <form action={(formData) => { const form = document.getElementById(`note-form-${clientId}`) as HTMLFormElement; submit({ body: formData.get("body") }, form); }} className="entity-form compact-mapping" id={`note-form-${clientId}`}>
    <fieldset><legend>Add note</legend><label>Note<textarea name="body" rows={3} required /></label></fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add note</button></div>
  </form>;
}

export function UploadDocumentForm({ clientId, title, identifiers, familyMembers }: { clientId: string; title?: string; identifiers?: Array<{ id: string; documentType: string; uniqueNumber: string }>; familyMembers?: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function upload(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/documents`, { method: "POST", body: formData });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Upload failed"); return; }
    toast.success("Document uploaded");
    router.refresh();
  }
  return <form action={upload} className="entity-form compact-mapping">
    <fieldset><legend>{title ?? "Upload document"}</legend><div className="form-row"><label>Name<input name="name" required /></label><label>Description<input name="description" /></label></div>{identifiers && identifiers.length > 0 ? <label>Tie to identity<select defaultValue="" name="identifierId"><option value="">Not linked to an identity</option>{identifiers.map((identifier) => <option key={identifier.id} value={identifier.id}>{identifier.documentType}{" \u00b7 "}{identifier.uniqueNumber}</option>)}</select></label> : null}{familyMembers && familyMembers.length > 0 ? <label>Tie to family member<select defaultValue="" name="familyMemberId"><option value="">Not linked to a family member</option>{familyMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label> : null}<label>File<input name="file" required type="file" /></label>{!identifiers && !familyMembers ? <label className="check-row"><input name="setAsPhoto" type="checkbox" /> Use as profile photo</label> : null}</fieldset>
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} Upload</button></div>
  </form>;
}

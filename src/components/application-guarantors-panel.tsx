"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { BrandActionButton } from "@/components/ui/brand-action-button";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";
import type { ApplicationGuarantor } from "@/modules/lending/application/application-guarantors";

export type GuarantorProfileView = ApplicationGuarantor & { id: string; documents: { id: string; name: string }[] };
type ClientOption = { id: string; accountNumber: string; firstName: string; lastName: string; mobileNumber: string | null; dateOfBirth: string | null; genderCode: string | null };

export function ApplicationGuarantorsPanel({ applicationId, guarantors, canManage }: {
  applicationId: string; guarantors: readonly GuarantorProfileView[]; canManage: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<DialogHandle>(null);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<GuarantorProfileView | null>(null);
  const [person, setPerson] = useState<ApplicationGuarantor>({ firstName: "", lastName: "", phone: "" });
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [searching, setSearching] = useState(false);
  function open(profile: GuarantorProfileView | null) {
    setEditing(profile); setPerson(profile ?? { firstName: "", lastName: "", phone: "" });
    setClients([]); setSearch(""); dialog.current?.showModal();
  }
  async function searchClients() {
    setSearching(true);
    try {
      const response = await fetch(`/api/loan-applications/${applicationId}/guarantors/clients?q=${encodeURIComponent(search)}`);
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Could not find clients"); return; }
      setClients(data.clients);
      if (!data.clients.length) toast.info("No matching clients in your permitted offices");
    } catch { toast.error("Could not search clients. Check your connection."); }
    finally { setSearching(false); }
  }
  async function submit() {
    setPending(true);
    try {
      const response = await fetch(`/api/loan-applications/${applicationId}/guarantors${editing ? `?profileId=${editing.id}` : ""}`, {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(Object.entries(person).filter(([key, value]) => key !== "id" && key !== "documents" && value !== ""))),
      });
      const result = await response.json();
      if (!response.ok) { toast.error(result.error ?? "Could not save guarantor"); return; }
      toast.success("Guarantor profile saved"); dialog.current?.close(); router.refresh();
    } catch { toast.error("Could not save. Refresh before retrying."); }
    finally { setPending(false); }
  }
  return <>
    {!guarantors.length ? <div className="empty-state compact-empty"><strong>No guarantors recorded</strong><p>Select an existing client or add an external person, then attach their supporting documents.</p></div> : <div className="table-scroll"><table>
      <thead><tr><th>Name</th><th>Phone</th><th>Relationship</th><th>Documents</th><th></th></tr></thead>
      <tbody>{guarantors.map((profile) => <tr key={profile.id}><td><Link className="green-link" href={`/guarantors/${profile.id}`}>{profile.firstName} {profile.lastName}</Link><small>{profile.clientId ? "Existing client" : "External guarantor"}</small></td><td>{profile.phone}</td><td>{profile.relationship || "-"}</td><td><Link className="green-link" href={`/guarantors/${profile.id}`}>{profile.documents.length} · Open profile</Link></td><td>{canManage ? <button type="button" className="secondary-action" onClick={() => open(profile)}>Edit</button> : null}</td></tr>)}</tbody>
    </table></div>}
    {canManage ? <BrandActionButton type="button" onClick={() => open(null)}>Add guarantor</BrandActionButton> : null}
    <Dialog ref={dialog} title={editing ? "Edit guarantor" : "Add guarantor"}>
      <div className="entity-form">
        <fieldset disabled={pending}><legend>Existing person in the system</legend>
          <label>Search clients by name, phone, or account number<input value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <button type="button" className="secondary-action" disabled={searching || search.trim().length < 2} onClick={searchClients}>{searching ? "Searching..." : "Search clients"}</button>
          {clients.map((client) => <button key={client.id} type="button" className="secondary-action" onClick={() => {
            setPerson({ ...person, clientId: client.id, firstName: client.firstName, lastName: client.lastName, phone: client.mobileNumber ?? "", dateOfBirth: client.dateOfBirth?.slice(0, 10), gender: client.genderCode ?? undefined }); setClients([]);
          }}>{client.accountNumber} · {client.firstName} {client.lastName}</button>)}
          {person.clientId ? <p>Linked to an existing client. <button type="button" onClick={() => setPerson({ ...person, clientId: undefined })}>Use as external person instead</button></p> : <p>Or enter an external guarantor below.</p>}
        </fieldset>
        <form action={submit}>
          <fieldset disabled={pending}><legend>Biodata</legend>
            {(["firstName", "lastName", "phone", "relationship", "dateOfBirth", "gender", "nationalId", "address", "occupation", "employer"] as const).map((field) => <label key={field}>
              {{ firstName: "First name", lastName: "Last name", phone: "Phone", relationship: "Relationship to borrower", dateOfBirth: "Date of birth", gender: "Gender", nationalId: "National ID / identification", address: "Residential address", occupation: "Occupation", employer: "Employer / business" }[field]}
              <input value={person[field] ?? ""} required={["firstName", "lastName", "phone"].includes(field)} type={field === "dateOfBirth" ? "date" : field === "phone" ? "tel" : "text"} max={field === "dateOfBirth" ? new Date().toISOString().slice(0, 10) : undefined} maxLength={field === "address" ? 1000 : field === "phone" || field === "gender" ? 50 : 150} onChange={(e) => setPerson({ ...person, [field]: e.target.value })} />
            </label>)}
            <label>Bio / background<textarea rows={3} maxLength={2000} value={person.bio ?? ""} onChange={(e) => setPerson({ ...person, bio: e.target.value })} /></label>
          </fieldset>
          <p>Save the profile, then open it to upload ID, guarantee forms, or other documents. This does not change the linked client&apos;s biodata.</p>
          <div className="form-actions"><BrandActionButton type="submit" disabled={pending}>{pending ? "Saving..." : "Save guarantor"}</BrandActionButton></div>
        </form>
      </div>
    </Dialog>
  </>;
}

export function GuarantorDocuments({ profileId, documents, canManage }: { profileId: string; documents: { id: string; name: string }[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function upload(form: FormData) {
    setPending(true);
    try {
      const response = await fetch(`/api/guarantors/${profileId}/documents`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error ?? "Could not upload document"); return; }
      toast.success("Guarantor document uploaded"); router.refresh();
    } catch { toast.error("Could not upload. Check your connection and refresh before retrying."); }
    finally { setPending(false); }
  }
  return <>
    {documents.length ? <ul>{documents.map((doc) => <li key={doc.id}><a className="green-link" href={`/api/guarantors/${profileId}/documents?documentId=${doc.id}`}>{doc.name}</a></li>)}</ul> : <p>No guarantor documents uploaded yet.</p>}
    {canManage ? <form action={upload} className="entity-form"><fieldset disabled={pending}><legend>Upload guarantor document</legend><label>Document name<input name="name" required maxLength={150} /></label><label>File (up to 15MB)<input name="file" type="file" required /></label></fieldset><BrandActionButton type="submit" disabled={pending}>{pending ? "Uploading..." : "Upload document"}</BrandActionButton></form> : <p>Documents remain available after approval; uploads are locked once approved.</p>}
  </>;
}

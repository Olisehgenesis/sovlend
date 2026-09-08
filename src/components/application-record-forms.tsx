"use client";

import { LoaderCircle, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type ApplicationNote = Readonly<{ id: string; body: string; authorName: string; createdAtLabel: string }>;
type ApplicationDocument = Readonly<{ id: string; name: string; description: string | null; mediaType: string; createdAtLabel: string }>;
type ApplicationCollateralItem = Readonly<{ type?: string; description?: string; estimatedValueLabel?: string }>;

export function ApplicationNotesPanel({ applicationId, notes, canManage }: { applicationId: string; notes: readonly ApplicationNote[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/loan-applications/${applicationId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: formData.get("body") }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not save this application note");
      return;
    }
    toast.success("Note added to the application review");
    router.refresh();
  }

  return (
    <>
      {notes.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No notes yet</strong>
          <p>Leave context for the checker reviewing this application.</p>
        </div>
      ) : (
        <ul className="note-list">
          {notes.map((note) => (
            <li key={note.id}>
              <p>{note.body}</p>
              <small>{note.authorName} | {note.createdAtLabel}</small>
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form action={submit} className="entity-form compact-mapping">
          <fieldset>
            <legend>Add note</legend>
            <label>
              Note
              <textarea name="body" rows={3} required />
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" disabled={pending}>
              {pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add note
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function ApplicationDocumentsPanel({ applicationId, documents, canManage }: { applicationId: string; documents: readonly ApplicationDocument[]; canManage: boolean }) {
  const router = useRouter();
  const [pendingUpload, setPendingUpload] = useState(false);

  async function upload(formData: FormData) {
    setPendingUpload(true);
    const response = await fetch(`/api/loan-applications/${applicationId}/documents`, { method: "POST", body: formData });
    const result = await response.json().catch(() => ({}));
    setPendingUpload(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not upload this application document");
      return;
    }
    toast.success("Document uploaded to the application review");
    router.refresh();
  }

  return (
    <>
      {documents.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No documents uploaded</strong>
          <p>Attach supporting paperwork for the checker to review.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Type</th>
                <th>Uploaded</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td><strong>{document.name}</strong></td>
                  <td>{document.description ?? "-"}</td>
                  <td>{document.mediaType}</td>
                  <td>{document.createdAtLabel}</td>
                  <td>
                    <a className="green-link" href={`/api/loan-applications/${applicationId}/documents/${document.id}`}>
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <form action={upload} className="entity-form compact-mapping">
          <fieldset>
            <legend>Upload document</legend>
            <div className="form-row">
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                Description
                <input name="description" />
              </label>
            </div>
            <label>
              File
              <input name="file" required type="file" />
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" disabled={pendingUpload}>
              {pendingUpload ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} Upload
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function ApplicationCollateralPanel({
  applicationId,
  items,
  currency,
  canManage,
}: {
  applicationId: string;
  items: readonly ApplicationCollateralItem[];
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function toMinor(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    const [whole, fraction = ""] = trimmed.split(".");
    return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
  }

  async function submit(formData: FormData) {
    setPending(true);
    const type = String(formData.get("type") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const estimatedValueMinor = toMinor(String(formData.get("estimatedValue") ?? ""));
    const response = await fetch(`/api/loan-applications/${applicationId}/collateral`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type || undefined, description: description || undefined, estimatedValueMinor: estimatedValueMinor ?? undefined }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not add this collateral to the application");
      return;
    }
    toast.success("Collateral added to the application review");
    router.refresh();
  }

  return (
    <>
      {items.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No collateral recorded</strong>
          <p>Collateral added here is created on the loan once this application is approved.</p>
        </div>
      ) : (
        <ul className="note-list">
          {items.map((item, index) => (
            <li key={index}>
              <p>{item.type || "Collateral"}{item.estimatedValueLabel ? ` · ${item.estimatedValueLabel}` : ""}</p>
              {item.description ? <small>{item.description}</small> : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form action={submit} className="entity-form compact-mapping">
          <fieldset>
            <legend>Add collateral</legend>
            <div className="form-row">
              <label>
                Type
                <input name="type" placeholder="e.g. Land title" />
              </label>
              <label>
                Value ({currency})
                <input inputMode="decimal" name="estimatedValue" />
              </label>
            </div>
            <label>
              Description
              <input name="description" />
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" disabled={pending}>
              {pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add collateral
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

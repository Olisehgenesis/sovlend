"use client";

import { LoaderCircle, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

type LoanNote = Readonly<{ id: string; body: string; authorName: string; createdAtLabel: string }>;
type LoanDocument = Readonly<{ id: string; name: string; description: string | null; mediaType: string; createdAtLabel: string }>;

export function LoanNotesPanel({ loanId, notes, canManage }: { loanId: string; notes: readonly LoanNote[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: formData.get("body") }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not add note");
      return;
    }
    toast.success("Note added");
    router.refresh();
  }

  return (
    <>
      {notes.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No notes yet</strong>
          <p>Leave context for other staff working on this loan.</p>
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
            <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">
              Add note
            </BrandActionButton>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function LoanDocumentsPanel({ loanId, documents, canManage }: { loanId: string; documents: readonly LoanDocument[]; canManage: boolean }) {
  const router = useRouter();
  const [pendingUpload, setPendingUpload] = useState(false);

  async function upload(formData: FormData) {
    setPendingUpload(true);
    const response = await fetch(`/api/loans/${loanId}/documents`, { method: "POST", body: formData });
    const result = await response.json().catch(() => ({}));
    setPendingUpload(false);
    if (!response.ok) {
      toast.error(result.error ?? "Upload failed");
      return;
    }
    toast.success("Document uploaded");
    router.refresh();
  }

  return (
    <>
      {documents.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No loan documents uploaded</strong>
          <p>Upload supporting paperwork below.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="clickable-rows">
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
                  <td>
                    <strong>{document.name}</strong>
                    <Link className="row-link" href={`/loans/${loanId}/documents/${document.id}`} aria-label={`Open document ${document.name}`} />
                  </td>
                  <td>{document.description ?? "-"}</td>
                  <td>{document.mediaType}</td>
                  <td>{document.createdAtLabel}</td>
                  <td style={{ position: "relative", zIndex: 1 }}>
                    <div className="account-card-actions">
                      <a className="green-link" href={`/api/documents/${document.id}`}>Download</a>
                    </div>
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
            <BrandActionButton disabled={pendingUpload} icon={pendingUpload ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} type="submit">
              Upload
            </BrandActionButton>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function CollateralNotesPanel({
  loanId,
  collateralId,
  notes,
  canManage,
}: {
  loanId: string;
  collateralId: string;
  notes: readonly LoanNote[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/collateral/${collateralId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: formData.get("body") }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not add note");
      return;
    }
    toast.success("Note added");
    router.refresh();
  }

  return (
    <>
      {notes.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No collateral notes yet</strong>
          <p>Leave context for staff reviewing this pledged asset.</p>
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
            <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">
              Add note
            </BrandActionButton>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function CollateralDocumentsPanel({
  loanId,
  collateralId,
  documents,
  canManage,
}: {
  loanId: string;
  collateralId: string;
  documents: readonly LoanDocument[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pendingUpload, setPendingUpload] = useState(false);

  async function upload(formData: FormData) {
    setPendingUpload(true);
    const response = await fetch(`/api/loans/${loanId}/collateral/${collateralId}/documents`, {
      method: "POST",
      body: formData,
    });
    const result = await response.json().catch(() => ({}));
    setPendingUpload(false);
    if (!response.ok) {
      toast.error(result.error ?? "Upload failed");
      return;
    }
    toast.success("Document uploaded");
    router.refresh();
  }

  return (
    <>
      {documents.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No collateral documents uploaded</strong>
          <p>Upload photos, ownership proof, and valuation paperwork below.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="clickable-rows">
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
                  <td>
                    <strong>{document.name}</strong>
                    <Link className="row-link" href={`/loans/${loanId}/documents/${document.id}`} aria-label={`Open document ${document.name}`} />
                  </td>
                  <td>{document.description ?? "-"}</td>
                  <td>{document.mediaType}</td>
                  <td>{document.createdAtLabel}</td>
                  <td style={{ position: "relative", zIndex: 1 }}>
                    <div className="account-card-actions">
                      <a className="green-link" href={`/api/documents/${document.id}`}>Download</a>
                    </div>
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
            <BrandActionButton disabled={pendingUpload} icon={pendingUpload ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} type="submit">
              Upload
            </BrandActionButton>
          </div>
        </form>
      ) : null}
    </>
  );
}

"use client";

import { LoaderCircle, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
            <button className="invest-button" disabled={pending}>
              {pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add note
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function LoanDocumentsPanel({ loanId, documents, canManage }: { loanId: string; documents: readonly LoanDocument[]; canManage: boolean }) {
  const router = useRouter();
  const [pendingUpload, setPendingUpload] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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

  async function remove(documentId: string) {
    setPendingDelete(documentId);
    const response = await fetch(`/api/loans/${loanId}/documents/${documentId}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    setPendingDelete(null);
    if (!response.ok) {
      toast.error(result.error ?? "Could not remove document");
      return;
    }
    toast.success("Document removed from loan");
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
                    <div className="account-card-actions">
                      <a className="green-link" href={`/api/documents/${document.id}`}>Download</a>
                      {canManage ? (
                        <button className="icon-action danger" disabled={pendingDelete === document.id} onClick={() => remove(document.id)} title="Remove from loan" type="button">
                          {pendingDelete === document.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                        </button>
                      ) : null}
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
            <button className="invest-button" disabled={pendingUpload}>
              {pendingUpload ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} Upload
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

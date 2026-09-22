"use client";

import { Building2, Check, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Lead = {
  id: string;
  name: string;
  email: string;
  organizationName: string;
  message: string | null;
  createdAt: string;
};

export function InvestorLeadReviewList({ leads }: { leads: Lead[] }) {
  const [rows, setRows] = useState(leads);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function decide(id: string, action: "approve" | "reject") {
    setBusyId(id);
    const response = await fetch(`/api/investor/access-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = await response.json().catch(() => null);
    setBusyId(null);
    if (!response.ok) {
      toast.error(result?.error ?? "Could not update this request");
      return;
    }
    setRows((current) => current.filter((row) => row.id !== id));
    if (action === "reject") {
      toast.success("Lead rejected");
      return;
    }
    if (result?.kind === "invited" && result.inviteUrl) {
      setInviteUrl(result.inviteUrl);
      toast.success("Invite created -- copy the link and send it to the investor");
      return;
    }
    toast.success("Investor access approved");
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  }

  if (rows.length === 0 && !inviteUrl) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Inbound investor leads</h2>
            <p>Submitted on the public request form before an account existed. Approve to grant access, or send an invite if they still need to sign up.</p>
          </div>
        </div>
        <div className="empty-state">
          <Building2 size={28} />
          <strong>No pending leads</strong>
          <p>New public access requests will appear here with Approve and Reject.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Inbound investor leads</h2>
          <p>Submitted on the public request form before an account existed. Approve to grant access, or send an invite if they still need to sign up.</p>
        </div>
      </div>
      {inviteUrl ? (
        <button className="copy-link" type="button" onClick={copyInvite}>{inviteUrl}</button>
      ) : null}
      {rows.length === 0 ? (
        <div className="empty-state">
          <Building2 size={28} />
          <strong>No pending leads</strong>
          <p>New public access requests will appear here.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Business</th>
                <th>Message</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.email}</td>
                  <td>{row.organizationName}</td>
                  <td>{row.message ?? <span className="muted-text">—</span>}</td>
                  <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button type="button" className="check-status-button" disabled={busyId === row.id} onClick={() => decide(row.id, "approve")}>
                      {busyId === row.id ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Approve
                    </button>
                    <button type="button" className="check-status-button" disabled={busyId === row.id} onClick={() => decide(row.id, "reject")}>
                      {busyId === row.id ? <LoaderCircle className="spin" size={14} /> : <X size={14} />} Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

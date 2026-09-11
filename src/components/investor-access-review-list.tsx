"use client";

import { Building2, Check, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type AccessRequest = {
  id: string;
  investorName: string;
  kycStatus: string;
  organizationName: string;
  createdAt: string;
};

export function InvestorAccessReviewList({ requests }: { requests: AccessRequest[] }) {
  const [rows, setRows] = useState(requests);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, action: "approve" | "reject") {
    setBusyId(id);
    const response = await fetch(`/api/investor/access/${id}`, {
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
    toast.success(action === "approve" ? "Business access approved" : "Access request rejected");
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <Building2 size={28} />
        <strong>No pending requests</strong>
        <p>New investor business-access requests will appear here for review.</p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Investor</th>
            <th>KYC</th>
            <th>Business</th>
            <th>Requested</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.investorName}</strong></td>
              <td><span className={`status ${row.kycStatus === "VERIFIED" ? "up-to-date" : "review"}`}>{row.kycStatus}</span></td>
              <td>{row.organizationName}</td>
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
  );
}

"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

export function LoanDeleteRejectPanel({
  applicationId,
  expectedUpdatedAt,
  canDelete,
  canReject,
}: {
  applicationId: string;
  expectedUpdatedAt: string;
  canDelete: boolean;
  canReject: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"delete" | "reject" | null>(null);

  async function submit(action: "delete" | "reject", formData: FormData) {
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) { toast.error("Add a reason first"); return; }
    if (action === "delete" && !window.confirm("Delete this loan application? Disbursed loans cannot be deleted. This cannot be undone.")) return;
    setPending(action);
    const response = await fetch(`/api/loan-applications/${applicationId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, expectedUpdatedAt }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) { toast.error(result.error ?? (action === "delete" ? "Could not delete this loan" : "Could not reject this application")); return; }
    if (action === "delete") {
      toast.success("Loan application deleted");
      router.push("/loans/applications");
      router.refresh();
      return;
    }
    toast.success("Loan application rejected");
    router.refresh();
  }

  if (!canDelete && !canReject) return null;

  return (
    <section className="panel loan-decision-panel">
      <div className="panel-heading">
        <div>
          <h2>{canReject ? "Reject or delete" : "Delete loan"}</h2>
          <p>Disbursed loans stay on the record. Reject keeps a submitted application on file. Delete removes an application that has not moved money.</p>
        </div>
      </div>
      {canReject ? (
        <form action={(formData) => submit("reject", formData)} className="entity-form compact-mapping">
          <label>Reason for rejection<textarea name="reason" required rows={2} maxLength={1000} /></label>
          <div className="form-actions">
            <BrandActionButton disabled={pending !== null} type="submit" variant="gold">
              {pending === "reject" ? <LoaderCircle className="spin" size={16} /> : null}
              Reject this application
            </BrandActionButton>
          </div>
        </form>
      ) : null}
      {canDelete ? (
        <form action={(formData) => submit("delete", formData)} className="entity-form compact-mapping">
          <label>Reason for deletion<textarea name="reason" required rows={2} maxLength={1000} /></label>
          <div className="form-actions">
            <BrandActionButton disabled={pending !== null} type="submit" variant="gold">
              {pending === "delete" ? <LoaderCircle className="spin" size={16} /> : null}
              Delete this application
            </BrandActionButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}

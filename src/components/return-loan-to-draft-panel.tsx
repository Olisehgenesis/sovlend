"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BrandActionButton } from "@/components/ui/brand-action-button";
export function ReturnLoanToDraftPanel({ loanId, updatedAt }: { loanId: string; updatedAt: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function submit(form: FormData) {
    setPending(true);
    try {
      const response = await fetch(`/api/loans/${loanId}/return-to-draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: form.get("reason"), expectedUpdatedAt: updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) { toast.error(result.error ?? "Could not return to draft"); return; }
      toast.success("Loan returned to draft. Edit and submit it for fresh approval.");
      router.push(`/loans/applications/${result.applicationId}`); router.refresh();
    } catch { toast.error("Could not return to draft. Refresh before retrying."); }
    finally { setPending(false); }
  }
  return <section className="panel"><div className="panel-heading"><h2>Return to draft</h2></div>
    <form action={submit} className="entity-form"><p>This removes the current approval and blocks disbursement. The loan number, guarantors, documents, and approval history are retained. Edit the draft, submit it, and obtain fresh approval before disbursing.</p>
      <fieldset disabled={pending}><label>Reason<textarea name="reason" required maxLength={1000} rows={3} /></label><label className="check-row"><input type="checkbox" required />I confirm this loan should become unapproved and require fresh approval.</label></fieldset>
      <div className="form-actions"><BrandActionButton type="submit" disabled={pending}>{pending ? "Returning..." : "Return to draft"}</BrandActionButton></div>
    </form></section>;
}

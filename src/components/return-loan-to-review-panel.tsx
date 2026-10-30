"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BrandActionButton } from "@/components/ui/brand-action-button";

export function ReturnLoanToReviewPanel({ loanId, updatedAt }: { loanId: string; updatedAt: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function submit(form: FormData) {
    setPending(true);
    try {
      const response = await fetch(`/api/loans/${loanId}/return-to-review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: form.get("reason"), expectedUpdatedAt: updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) { toast.error(result.error ?? "Could not return to review"); return; }
      toast.success("Loan returned to review. It needs approval again before disbursement.");
      router.push(`/loans/applications/${result.applicationId}`); router.refresh();
    } catch { toast.error("Could not return to review. Refresh before retrying."); }
    finally { setPending(false); }
  }
  return <section className="panel"><div className="panel-heading"><h2>Return to review</h2></div>
    <form action={submit} className="entity-form"><p>This removes the current approval and sends the application back to review. A payout that was fully reversed can go back too. The reversal stays on the record. Disbursement stays blocked until someone approves it again.</p>
      <fieldset disabled={pending}><label>Reason<textarea name="reason" required maxLength={1000} rows={3} /></label><label className="check-row"><input type="checkbox" required />I confirm this loan should leave Approved and wait for review again.</label></fieldset>
      <div className="form-actions"><BrandActionButton type="submit" disabled={pending}>{pending ? "Returning..." : "Return to review"}</BrandActionButton></div>
    </form></section>;
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BrandActionButton } from "@/components/ui/brand-action-button";
export function SubmitLoanDraftButton({ applicationId }: { applicationId: string }) {
  const router = useRouter(); const [pending, setPending] = useState(false);
  async function submit() {
    setPending(true);
    try {
      const response = await fetch(`/api/loan-applications/${applicationId}/submit`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) { toast.error(result.error ?? "Could not submit draft"); return; }
      toast.success("Submitted for fresh approval"); router.refresh();
    } catch { toast.error("Could not submit. Refresh before retrying."); }
    finally { setPending(false); }
  }
  return <BrandActionButton type="button" disabled={pending} onClick={submit}>{pending ? "Submitting..." : "Submit draft for approval"}</BrandActionButton>;
}

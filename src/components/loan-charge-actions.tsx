"use client";

import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

// Pay/waive actions for a single charge, shared between the loan charge detail page and any
// other place a lone charge needs the same confirm-then-PATCH flow (see LoanChargesPanel for the
// list-row equivalent — kept separate since the list already owns its own bulk state).
export function LoanChargeActions({ loanId, chargeId, status }: { loanId: string; chargeId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"PAID" | "WAIVED" | null>(null);

  if (status !== "PENDING") return null;

  async function setStatus(next: "PAID" | "WAIVED") {
    const confirmed = window.confirm(
      next === "PAID"
        ? "Mark this loan charge as paid? Use this only when the amount has already been collected."
        : "Waive this loan charge? The amount will no longer be due on this loan.",
    );
    if (!confirmed) return;
    setPending(next);
    const response = await fetch(`/api/loans/${loanId}/charges/${chargeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) {
      toast.error(result.error ?? (next === "PAID" ? "Could not mark this loan charge as paid" : "Could not waive this loan charge"));
      return;
    }
    toast.success(next === "PAID" ? "Loan charge marked as paid" : "Loan charge waived");
    router.refresh();
  }

  return (
    <div className="header-actions">
      <BrandActionButton disabled={pending !== null} icon={pending === "PAID" ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />} onClick={() => setStatus("PAID")} type="button">
        Pay charge
      </BrandActionButton>
      <button className="secondary-action" disabled={pending !== null} onClick={() => setStatus("WAIVED")} type="button">
        {pending === "WAIVED" ? <LoaderCircle className="spin" size={16} /> : <XCircle size={16} />} Waive charge
      </button>
    </div>
  );
}

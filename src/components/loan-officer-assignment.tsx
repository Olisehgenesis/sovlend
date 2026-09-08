"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function LoanOfficerAssignment({ loanId, currentOfficerId, officers }: { loanId: string; currentOfficerId: string | null; officers: ReadonlyArray<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function assign(formData: FormData) {
    const officerId = String(formData.get("officerId") || "");
    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/assign-officer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officerId: officerId || null }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not update the loan officer"); return; }
    toast.success("Loan officer updated");
    router.refresh();
  }

  return (
    <form action={assign} className="inline-assign-form">
      <select defaultValue={currentOfficerId ?? ""} name="officerId">
        <option value="">Unassigned</option>
        {officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.name}</option>)}
      </select>
      <button className="secondary-action" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={14} /> : "Save"}</button>
    </form>
  );
}

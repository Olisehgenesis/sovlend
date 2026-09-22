"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function StaffAssignment({
  actionUrl,
  currentOfficerId,
  officers,
  successMessage = "Staff updated",
}: {
  actionUrl: string;
  currentOfficerId: string | null;
  officers: ReadonlyArray<{ id: string; name: string }>;
  successMessage?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function assign(formData: FormData) {
    const officerId = String(formData.get("officerId") || "");
    setPending(true);
    const response = await fetch(actionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officerId: officerId || null }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not update staff");
      return;
    }
    toast.success(successMessage);
    router.refresh();
  }

  return (
    <form action={assign} className="inline-assign-form">
      <select aria-label="Assigned staff" defaultValue={currentOfficerId ?? ""} key={currentOfficerId ?? "unassigned"} name="officerId">
        <option value="">Unassigned</option>
        {officers.map((officer) => (
          <option key={officer.id} value={officer.id}>
            {officer.name}
          </option>
        ))}
      </select>
      <button className="secondary-action" disabled={pending} type="submit">
        {pending ? <LoaderCircle className="spin" size={14} /> : "Save"}
      </button>
    </form>
  );
}

export function LoanOfficerAssignment({
  loanId,
  currentOfficerId,
  officers,
}: {
  loanId: string;
  currentOfficerId: string | null;
  officers: ReadonlyArray<{ id: string; name: string }>;
}) {
  return (
    <StaffAssignment
      actionUrl={`/api/loans/${loanId}/assign-officer`}
      currentOfficerId={currentOfficerId}
      officers={officers}
      successMessage="Loan officer updated"
    />
  );
}

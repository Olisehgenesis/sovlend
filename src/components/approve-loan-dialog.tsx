"use client";

import { CheckCircle2 } from "lucide-react";
import { useRef } from "react";

import { ApproveLoanForm } from "@/components/approve-loan-form";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

export function ApproveLoanDialog({
  applicationId,
  proposedAmount,
  label = "Approve",
}: {
  applicationId: string;
  proposedAmount: string;
  label?: string;
}) {
  const dialogRef = useRef<DialogHandle>(null);

  return (
    <>
      <button
        type="button"
        className="green-link"
        onClick={() => dialogRef.current?.showModal()}
        style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
      >
        <CheckCircle2 size={16} /> {label}
      </button>
      <Dialog ref={dialogRef} title="Approve loan application" className="approve-dialog">
        <ApproveLoanForm applicationId={applicationId} proposedAmount={proposedAmount} />
      </Dialog>
    </>
  );
}

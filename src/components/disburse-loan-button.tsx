"use client";

import { Banknote, X } from "lucide-react";
import { useRef } from "react";

import { DisburseLoanForm } from "@/components/disburse-loan-form";

export function DisburseLoanButton({
  loanId,
  settlementAccounts,
  savingsAccounts,
}: {
  loanId: string;
  settlementAccounts: Array<{ id: string; name: string; type: string }>;
  savingsAccounts: Array<{
    id: string;
    accountNumber: string;
    isDefault: boolean;
    productName?: string | null;
  }>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        className="invest-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <Banknote size={16} /> Disburse
      </button>
      <dialog className="app-modal" ref={dialogRef}>
        <div className="app-modal-heading">
          <h2>Disburse loan</h2>
          <button
            aria-label="Close"
            className="icon-action"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <DisburseLoanForm
          loanId={loanId}
          onSuccess={() => dialogRef.current?.close()}
          savingsAccounts={savingsAccounts}
          settlementAccounts={settlementAccounts}
        />
      </dialog>
    </>
  );
}

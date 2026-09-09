"use client";

import { Banknote } from "lucide-react";
import { useRef } from "react";

import { DisburseLoanForm } from "@/components/disburse-loan-form";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

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
  const dialogRef = useRef<DialogHandle>(null);

  return (
    <>
      <button
        className="invest-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <Banknote size={16} /> Disburse
      </button>
      <Dialog ref={dialogRef} title="Disburse loan">
        <DisburseLoanForm
          loanId={loanId}
          onSuccess={() => dialogRef.current?.close()}
          savingsAccounts={savingsAccounts}
          settlementAccounts={settlementAccounts}
        />
      </Dialog>
    </>
  );
}

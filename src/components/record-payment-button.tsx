"use client";

import { Banknote, X } from "lucide-react";
import { useRef } from "react";

import { RepaymentForm } from "@/components/repayment-form";

/** Header-level shortcut so an operator can record a repayment without leaving whatever
 * tab of the loan page they're on — wraps the existing RepaymentForm (used by the
 * "Record Payment" tab) in a native <dialog> instead of duplicating its logic. */
export function RecordPaymentButton({
  loanId,
  settlementAccounts,
  defaultAmountMinor,
}: {
  loanId: string;
  settlementAccounts: Array<{ id: string; name: string; type: string }>;
  defaultAmountMinor?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="invest-button" onClick={() => dialogRef.current?.showModal()} type="button">
        <Banknote size={16} /> Record payment
      </button>
      <dialog className="app-modal" ref={dialogRef}>
        <div className="app-modal-heading">
          <h2>Record repayment</h2>
          <button aria-label="Close" className="icon-action" onClick={() => dialogRef.current?.close()} type="button">
            <X size={16} />
          </button>
        </div>
        <RepaymentForm
          defaultAmountMinor={defaultAmountMinor}
          loanId={loanId}
          onSuccess={() => dialogRef.current?.close()}
          settlementAccounts={settlementAccounts}
        />
      </dialog>
    </>
  );
}

"use client";

import { Banknote } from "lucide-react";
import { useRef } from "react";

import { RepaymentForm } from "@/components/repayment-form";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

/** Header-level shortcut so an operator can record a repayment without leaving whatever
 * tab of the loan page they're on — wraps the existing RepaymentForm (used by the
 * "Record Payment" tab) in a shared Dialog instead of duplicating its logic. */
export function RecordPaymentButton({
  loanId,
  settlementAccounts,
  defaultAmountMinor,
}: {
  loanId: string;
  settlementAccounts: Array<{ id: string; name: string; type: string }>;
  defaultAmountMinor?: string;
}) {
  const dialogRef = useRef<DialogHandle>(null);

  return (
    <>
      <button className="invest-button" onClick={() => dialogRef.current?.showModal()} type="button">
        <Banknote size={16} /> Record payment
      </button>
      <Dialog ref={dialogRef} title="Record repayment">
        <RepaymentForm
          defaultAmountMinor={defaultAmountMinor}
          loanId={loanId}
          onSuccess={() => dialogRef.current?.close()}
          settlementAccounts={settlementAccounts}
        />
      </Dialog>
    </>
  );
}

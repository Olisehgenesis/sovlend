"use client";

import { Banknote, ArrowUpCircle } from "lucide-react";
import { useRef, useState } from "react";

import { DisburseLoanForm } from "@/components/disburse-loan-form";
import { type DisbursementPayoutContext } from "@/components/disbursement-payout-preview";
import { type LoanPreviewInput } from "@/components/loan-preview-panel";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";
import { BrandActionButton } from "@/components/ui/brand-action-button";

export function DisburseLoanButton({
  loanId,
  settlementAccounts,
  savingsAccounts,
  payoffLoanOptions,
  preview,
  payout,
}: {
  loanId: string;
  settlementAccounts: Array<{ id: string; name: string; type: string }>;
  savingsAccounts: Array<{
    id: string;
    accountNumber: string;
    isDefault: boolean;
    productName?: string | null;
  }>;
  payoffLoanOptions?: Array<{
    id: string;
    accountNumber: string;
    outstandingMinor: string;
    currencyCode: string;
  }>;
  preview?: LoanPreviewInput;
  payout?: DisbursementPayoutContext;
}) {
  const dialogRef = useRef<DialogHandle>(null);
  const [asTopUp, setAsTopUp] = useState(false);

  return (
    <>
      {payoffLoanOptions?.length ? <button className="secondary-action" type="button" onClick={() => { setAsTopUp(true); dialogRef.current?.showModal(); }}><ArrowUpCircle size={16} /> Disburse as top-up</button> : null}
      <BrandActionButton
        icon={<Banknote size={16} />}
        onClick={() => { setAsTopUp(false); dialogRef.current?.showModal(); }}
        type="button"
      >
        Disburse
      </BrandActionButton>
      <Dialog className={preview || payout ? "loan-preview-modal" : undefined} ref={dialogRef} title="Disburse loan">
        <DisburseLoanForm
          key={String(asTopUp)}
          initialAsTopUp={asTopUp}
          loanId={loanId}
          onSuccess={() => dialogRef.current?.close()}
          payoffLoanOptions={payoffLoanOptions}
          payout={payout}
          preview={preview}
          savingsAccounts={savingsAccounts}
          settlementAccounts={settlementAccounts}
        />
      </Dialog>
    </>
  );
}

"use client";

import { Banknote } from "lucide-react";
import { useRef } from "react";

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

  return (
    <>
      <BrandActionButton
        icon={<Banknote size={16} />}
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        Disburse
      </BrandActionButton>
      <Dialog className={preview || payout ? "loan-preview-modal" : undefined} ref={dialogRef} title="Disburse loan">
        <DisburseLoanForm
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

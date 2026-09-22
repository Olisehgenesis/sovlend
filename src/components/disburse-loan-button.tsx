"use client";

import { Banknote } from "lucide-react";
import { useRef } from "react";

import { DisburseLoanForm } from "@/components/disburse-loan-form";
import { type LoanPreviewInput } from "@/components/loan-preview-panel";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";
import { BrandActionButton } from "@/components/ui/brand-action-button";

export function DisburseLoanButton({
  loanId,
  settlementAccounts,
  savingsAccounts,
  payoffLoanOptions,
  preview,
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
      <Dialog className={preview ? "loan-preview-modal" : undefined} ref={dialogRef} title="Disburse loan">
        <DisburseLoanForm
          loanId={loanId}
          onSuccess={() => dialogRef.current?.close()}
          payoffLoanOptions={payoffLoanOptions}
          preview={preview}
          savingsAccounts={savingsAccounts}
          settlementAccounts={settlementAccounts}
        />
      </Dialog>
    </>
  );
}

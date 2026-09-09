"use client";

import { PiggyBank } from "lucide-react";
import { useRef } from "react";

import { DepositWithdrawForm, type SavingsDepositTarget, type SettlementAccountOption } from "@/components/client-account-panel";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

/** Header-level shortcut so an operator can top up the borrower's savings account without
 * leaving the loan page to find the client's Savings tab — wraps the same DepositWithdrawForm
 * used there, pre-selected onto the client's active savings account (see RecordPaymentButton for
 * the equivalent "Record payment" shortcut this sits next to). */
export function LoanTopUpButton({
  clientId,
  currentUserName,
  savingsTarget,
  settlementAccounts,
}: {
  clientId: string;
  currentUserName: string;
  savingsTarget: SavingsDepositTarget;
  settlementAccounts: readonly SettlementAccountOption[];
}) {
  const dialogRef = useRef<DialogHandle>(null);

  return (
    <>
      <button className="secondary-action" onClick={() => dialogRef.current?.showModal()} type="button">
        <PiggyBank size={16} /> Top up
      </button>
      <Dialog ref={dialogRef} title="Top up savings">
        <DepositWithdrawForm
          clientId={clientId}
          currentUserName={currentUserName}
          initialTargetKey={`savings:${savingsTarget.id}`}
          loanTargets={[]}
          onSuccess={() => dialogRef.current?.close()}
          savingsTarget={savingsTarget}
          settlementAccounts={settlementAccounts}
        />
      </Dialog>
    </>
  );
}

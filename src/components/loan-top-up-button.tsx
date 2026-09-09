"use client";

import { PiggyBank } from "lucide-react";
import { useRef } from "react";

import { DepositWithdrawForm, type SavingsDepositTarget, type SettlementAccountOption } from "@/components/client-account-panel";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

/** Header-level shortcut so an operator can top up the borrower's savings account without
 * leaving the loan page to find the client's Savings tab — wraps the same DepositWithdrawForm
 * used there, pre-selected onto the client's default savings account but still lets them switch
 * between multiple savings accounts if the client holds more than one (see RecordPaymentButton
 * for the equivalent "Record payment" shortcut this sits next to). */
export function LoanTopUpButton({
  clientId,
  currentUserName,
  savingsTargets,
  settlementAccounts,
}: {
  clientId: string;
  currentUserName: string;
  savingsTargets: readonly SavingsDepositTarget[];
  settlementAccounts: readonly SettlementAccountOption[];
}) {
  const dialogRef = useRef<DialogHandle>(null);
  const defaultSavingsTarget = savingsTargets.find((account) => account.isDefault) ?? savingsTargets[0] ?? null;

  return (
    <>
      <button className="secondary-action" onClick={() => dialogRef.current?.showModal()} type="button">
        <PiggyBank size={16} /> Top up
      </button>
      <Dialog ref={dialogRef} title="Top up savings">
        <DepositWithdrawForm
          allowedActions={["DEPOSIT"]}
          clientId={clientId}
          currentUserName={currentUserName}
          initialTargetKey={defaultSavingsTarget ? `savings:${defaultSavingsTarget.id}` : undefined}
          lockTarget
          loanTargets={[]}
          onSuccess={() => dialogRef.current?.close()}
          savingsTargets={savingsTargets}
          settlementAccounts={settlementAccounts}
        />
      </Dialog>
    </>
  );
}

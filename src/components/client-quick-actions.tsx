"use client";

import { ArrowLeftRight, Banknote, PiggyBank, Wallet } from "lucide-react";
import { useRef, useState } from "react";

import {
  DepositWithdrawForm,
  TransferToLoanForm,
  type LoanDepositTarget,
  type SavingsDepositTarget,
  type SettlementAccountOption,
} from "@/components/client-account-panel";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

type TransferSourceAccount = Readonly<{
  id: string;
  accountNumber: string;
  currencyCode: string;
  balanceMinor: string;
}>;

/**
 * Header-level shortcuts on the client detail page so an operator can move money without
 * hunting for the Savings tab. All four reuse the same accounting-safe forms the Savings tab
 * already used (DepositWithdrawForm / TransferToLoanForm) -- this only adds faster, purpose-
 * built entry points into them, each pre-selecting the relevant target.
 */
export function ClientQuickActions({
  clientId,
  currentUserName,
  settlementAccounts,
  savingsTarget,
  loanTargets,
  transferSourceAccounts,
  canTransact,
  canRecordRepayment,
}: {
  clientId: string;
  currentUserName: string;
  settlementAccounts: readonly SettlementAccountOption[];
  savingsTarget: SavingsDepositTarget | null;
  loanTargets: readonly LoanDepositTarget[];
  transferSourceAccounts: readonly TransferSourceAccount[];
  canTransact: boolean;
  canRecordRepayment: boolean;
}) {
  const dialogRef = useRef<DialogHandle>(null);
  const [mode, setMode] = useState<"record" | "repay" | "topup" | "transfer">("record");

  const canRecordPayment = (canTransact && Boolean(savingsTarget)) || (canRecordRepayment && loanTargets.length > 0);
  const canRepayLoan = canRecordRepayment && loanTargets.length > 0;
  const canTopUp = canTransact && Boolean(savingsTarget);
  const canTransfer = canTransact && canRecordRepayment && transferSourceAccounts.length > 0 && loanTargets.length > 0;

  if (!canRecordPayment && !canRepayLoan && !canTopUp && !canTransfer) return null;

  function open(next: typeof mode) {
    setMode(next);
    dialogRef.current?.showModal();
  }

  const titles: Record<typeof mode, string> = {
    record: "Record payment",
    repay: "Repay loan",
    topup: "Top up savings",
    transfer: "Transfer savings to loan",
  };

  return (
    <div className="client-quick-actions">
      {canRecordPayment ? <button className="invest-button" onClick={() => open("record")} type="button"><Banknote size={15} /> Record payment</button> : null}
      {canRepayLoan ? <button className="secondary-action" onClick={() => open("repay")} type="button"><Wallet size={15} /> Repay loan</button> : null}
      {canTopUp ? <button className="secondary-action" onClick={() => open("topup")} type="button"><PiggyBank size={15} /> Top up</button> : null}
      {canTransfer ? <button className="secondary-action" onClick={() => open("transfer")} type="button"><ArrowLeftRight size={15} /> Transfer</button> : null}
      <Dialog ref={dialogRef} title={titles[mode]}>
        {mode === "transfer" ? (
          <TransferToLoanForm loanTargets={loanTargets} onSuccess={() => dialogRef.current?.close()} savingsAccounts={transferSourceAccounts} />
        ) : (
          <DepositWithdrawForm
            clientId={clientId}
            currentUserName={currentUserName}
            initialTargetKey={mode === "repay" && loanTargets[0] ? `loan:${loanTargets[0].id}` : mode === "topup" && savingsTarget ? `savings:${savingsTarget.id}` : undefined}
            loanTargets={loanTargets}
            onSuccess={() => dialogRef.current?.close()}
            savingsTarget={savingsTarget}
            settlementAccounts={settlementAccounts}
          />
        )}
      </Dialog>
    </div>
  );
}

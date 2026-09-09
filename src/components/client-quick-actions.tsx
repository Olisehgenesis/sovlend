"use client";

import { Banknote, Minus, PiggyBank } from "lucide-react";
import { useRef, useState } from "react";

import {
  DepositWithdrawForm,
  type LoanDepositTarget,
  type SavingsDepositTarget,
  type SettlementAccountOption,
} from "@/components/client-account-panel";
import { BrandActionButton } from "@/components/ui/brand-action-button";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

/**
 * Header-level shortcuts on the client detail page so an operator can move money without
 * hunting for the Savings tab. All three reuse the same accounting-safe DepositWithdrawForm the
 * Savings tab already uses -- this only adds faster, purpose-built entry points into it, each
 * pre-selecting the relevant target and restricting which action(s) it offers:
 *   - Record payment: the generic entry point -- works against either a loan (repayment,
 *     defaulting to the most overdue one) or the savings account, both deposit and withdraw
 *     available depending on the chosen target. Replaces the old separate "Repay loan" button,
 *     which opened the exact same form.
 *   - Top up: locked to the savings account, deposit only.
 *   - Withdraw: locked to the savings account, withdrawal only.
 */
export function ClientQuickActions({
  clientId,
  currentUserName,
  settlementAccounts,
  savingsTarget,
  loanTargets,
  canTransact,
  canRecordRepayment,
}: {
  clientId: string;
  currentUserName: string;
  settlementAccounts: readonly SettlementAccountOption[];
  savingsTarget: SavingsDepositTarget | null;
  loanTargets: readonly LoanDepositTarget[];
  canTransact: boolean;
  canRecordRepayment: boolean;
}) {
  const dialogRef = useRef<DialogHandle>(null);
  const [mode, setMode] = useState<"record" | "topup" | "withdraw">("record");

  const canRecordPayment = (canTransact && Boolean(savingsTarget)) || (canRecordRepayment && loanTargets.length > 0);
  const canTopUp = canTransact && Boolean(savingsTarget);
  const canWithdraw = canTransact && Boolean(savingsTarget);

  if (!canRecordPayment && !canTopUp && !canWithdraw) return null;

  function open(next: typeof mode) {
    setMode(next);
    dialogRef.current?.showModal();
  }

  const titles: Record<typeof mode, string> = {
    record: "Record payment",
    topup: "Top up savings",
    withdraw: "Withdraw from savings",
  };

  return (
    <div className="client-quick-actions">
      {canRecordPayment ? <BrandActionButton icon={<Banknote size={14} />} onClick={() => open("record")} variant="primary">Record payment</BrandActionButton> : null}
      {canTopUp ? <BrandActionButton icon={<PiggyBank size={14} />} onClick={() => open("topup")} variant="gold">Top up</BrandActionButton> : null}
      {canWithdraw ? <BrandActionButton icon={<Minus size={14} />} onClick={() => open("withdraw")} variant="blue">Withdraw</BrandActionButton> : null}
      <Dialog ref={dialogRef} title={titles[mode]}>
        <DepositWithdrawForm
          allowedActions={mode === "topup" ? ["DEPOSIT"] : mode === "withdraw" ? ["WITHDRAWAL"] : ["DEPOSIT", "WITHDRAWAL"]}
          clientId={clientId}
          currentUserName={currentUserName}
          initialTargetKey={(mode === "topup" || mode === "withdraw") && savingsTarget ? `savings:${savingsTarget.id}` : undefined}
          loanTargets={mode === "record" ? loanTargets : []}
          lockTarget={mode === "topup" || mode === "withdraw"}
          onSuccess={() => dialogRef.current?.close()}
          savingsTarget={savingsTarget}
          settlementAccounts={settlementAccounts}
        />
      </Dialog>
    </div>
  );
}

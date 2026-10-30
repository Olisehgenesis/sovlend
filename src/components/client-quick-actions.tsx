"use client";

import { ArrowLeftRight, Banknote, Minus, PiggyBank } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import {
  DepositWithdrawForm,
  TransferForm,
  type LoanDepositTarget,
  type SavingsDepositTarget,
  type SettlementAccountOption,
  type TransferSourceAccount,
} from "@/components/client-account-panel";
import { BrandActionButton } from "@/components/ui/brand-action-button";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

/**
 * Header-level shortcuts on the client detail page so an operator can move money without
 * hunting for the Savings tab. Transfer, Record payment, Top up and Withdraw all reuse the same
 * accounting-safe forms the Savings tab already uses -- this only adds faster, purpose-built
 * entry points into them, each pre-selecting the relevant target and restricting which action(s)
 * it offers:
 *   - Transfer: internal, cash-free move of the client's own money -- either between their own
 *     savings sub-accounts, or straight onto one of their loans as a repayment (never a generic
 *     balance transfer). Shown first since it never touches a settlement account, unlike the
 *     other three.
 *   - Record payment: only shown when the client has an open loan (this is a loan repayment
 *     shortcut, not a general deposit tool -- use Top up for savings). Defaults to the most
 *     overdue loan but still lets the operator switch between the client's savings accounts and
 *     any other open loan, same as before.
 *   - Top up: restricted to the client's savings accounts, deposit only. When the client holds
 *     more than one savings account, the operator picks which one to credit.
 *   - Withdraw: restricted to the client's savings accounts, withdrawal only, same multi-account
 *     picker as Top up.
 */
export function ClientQuickActions({
  clientId,
  currentUserName,
  settlementAccounts,
  savingsTargets,
  transferSavingsAccounts,
  loanTargets,
  canTransact,
  canRecordRepayment,
}: {
  clientId: string;
  currentUserName: string;
  settlementAccounts: readonly SettlementAccountOption[];
  savingsTargets: readonly SavingsDepositTarget[];
  transferSavingsAccounts: readonly TransferSourceAccount[];
  loanTargets: readonly LoanDepositTarget[];
  canTransact: boolean;
  canRecordRepayment: boolean;
}) {
  const dialogRef = useRef<DialogHandle>(null);
  const [mode, setMode] = useState<"transfer" | "record" | "topup" | "withdraw">("record");

  // Record payment is a loan-repayment shortcut -- only worth showing when the client actually
  // has an open loan to pay against, regardless of whether they also have savings.
  const canRecordPayment = canRecordRepayment && loanTargets.length > 0;
  const canTopUp = canTransact && savingsTargets.length > 0;
  const canWithdraw = canTransact && savingsTargets.length > 0;
  const canTransfer =
    canTransact && (transferSavingsAccounts.length >= 2 || (canRecordRepayment && transferSavingsAccounts.length > 0 && loanTargets.length > 0));

  if (!canTransfer && !canRecordPayment && !canTopUp && !canWithdraw) return null;

  function open(next: typeof mode) {
    setMode(next);
    dialogRef.current?.showModal();
  }

  const titles: Record<typeof mode, string> = {
    transfer: "Transfer",
    record: "Record payment",
    topup: "Top up savings",
    withdraw: "Withdraw from savings",
  };
  const defaultSavingsTarget = savingsTargets.find((account) => account.isDefault) ?? savingsTargets[0] ?? null;
  const lead: typeof mode | null = canRecordPayment ? "record" : canTopUp ? "topup" : canTransfer ? "transfer" : canWithdraw ? "withdraw" : null;
  const actions: { id: typeof mode; label: string; icon: ReactNode }[] = [];
  if (canTransfer) actions.push({ id: "transfer", label: "Transfer", icon: <ArrowLeftRight size={16} /> });
  if (canTopUp) actions.push({ id: "topup", label: "Top up", icon: <PiggyBank size={16} /> });
  if (canWithdraw) actions.push({ id: "withdraw", label: "Withdraw", icon: <Minus size={16} /> });
  if (canRecordPayment) actions.push({ id: "record", label: "Record payment", icon: <Banknote size={16} /> });
  const orderedActions = [...actions.filter((action) => action.id !== lead), ...actions.filter((action) => action.id === lead)];

  return (
    <div className="client-quick-actions">
      {orderedActions.map((action) => action.id === lead ? (
        <BrandActionButton icon={action.icon} key={action.id} onClick={() => open(action.id)}>{action.label}</BrandActionButton>
      ) : (
        <button className="secondary-action" key={action.id} onClick={() => open(action.id)} type="button">{action.icon}{action.label}</button>
      ))}
      <Dialog ref={dialogRef} title={titles[mode]}>
        {mode === "transfer" ? (
          <TransferForm
            canTransferToLoan={canRecordRepayment}
            loanTargets={loanTargets}
            onSuccess={() => dialogRef.current?.close()}
            savingsAccounts={transferSavingsAccounts}
          />
        ) : (
          <DepositWithdrawForm
            allowedActions={mode === "topup" ? ["DEPOSIT"] : mode === "withdraw" ? ["WITHDRAWAL"] : ["DEPOSIT", "WITHDRAWAL"]}
            clientId={clientId}
            currentUserName={currentUserName}
            initialTargetKey={(mode === "topup" || mode === "withdraw") && defaultSavingsTarget ? `savings:${defaultSavingsTarget.id}` : undefined}
            loanTargets={mode === "record" ? loanTargets : []}
            lockTarget={mode === "topup" || mode === "withdraw"}
            onSuccess={() => dialogRef.current?.close()}
            savingsTargets={canTransact ? savingsTargets : []}
            settlementAccounts={settlementAccounts}
          />
        )}
      </Dialog>
    </div>
  );
}

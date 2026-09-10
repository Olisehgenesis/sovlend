"use client";

import { CheckCircle2, LoaderCircle, Minus, Plus, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";
import { formatMinor } from "@/modules/money/domain/format-minor";

export type SettlementAccountOption = Readonly<{
  id: string;
  name: string;
  type: string;
  provider: string | null;
  accountReference: string | null;
  currencyCode: string;
}>;

export type SavingsDepositTarget = Readonly<{
  id: string;
  accountNumber: string;
  currencyCode: string;
  // The savings product name (e.g. "Member Savings Account", "Compulsory savings") -- shown
  // ahead of the account number in every picker so an operator can tell at a glance which kind
  // of account they're about to move money into, instead of scanning bare account numbers.
  productName: string;
  // A client can hold more than one savings account (e.g. personal + group-linked accounts) --
  // this flags which one is the designated default so forms can pre-select it without forcing
  // an operator to hunt for the right account when there's more than one option.
  isDefault: boolean;
}>;

export type LoanDepositTarget = Readonly<{
  id: string;
  accountNumber: string;
  productName: string;
  currencyCode: string;
  status: string;
  outstandingMinor: string;
  overdueMinor: string;
}>;

function parseAmountToMinor(amount: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}

function settlementLabel(account: SettlementAccountOption) {
  const detail = account.provider || account.type.replaceAll("_", " ");
  return `${account.name} · ${detail}${account.accountReference ? ` · ${account.accountReference}` : ""}`;
}

export function DepositWithdrawForm({
  clientId,
  currentUserName,
  settlementAccounts,
  savingsTargets,
  loanTargets,
  initialTargetKey,
  lockTarget = false,
  allowedActions = ["DEPOSIT", "WITHDRAWAL"],
  onSuccess,
}: {
  clientId: string;
  currentUserName: string;
  settlementAccounts: readonly SettlementAccountOption[];
  // A client can hold several active savings accounts at once (e.g. personal + group-linked) --
  // every one of them is offered here so an operator can pick the right account instead of
  // always landing on whichever the query happened to return first.
  savingsTargets: readonly SavingsDepositTarget[];
  loanTargets: readonly LoanDepositTarget[];
  // Pre-selects a target (e.g. "loan:<id>" or "savings:<id>") when this form is opened from a
  // purpose-built quick action (Top up / Withdraw) instead of the generic entry point.
  initialTargetKey?: string;
  // Restricts the target selector to savings accounts only -- used by the Top up and Withdraw
  // quick actions, which are only ever meant to act on one of the client's savings accounts (not
  // a loan). Still lets the operator choose between multiple savings accounts when there is more
  // than one; only collapses to a static read-only field when there's exactly one option.
  lockTarget?: boolean;
  // Restricts which of Deposit/Withdraw are offered -- Top up only shows Deposit, Withdraw only
  // shows Withdraw, and the generic Record payment keeps both (default).
  allowedActions?: readonly ("DEPOSIT" | "WITHDRAWAL")[];
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"DEPOSIT" | "WITHDRAWAL" | null>(null);
  const targetOptions = useMemo(() => {
    const options: Array<{ key: string; id: string; kind: "savings" | "loan"; accountNumber: string; currencyCode: string; label: string; hint: string }> = [];
    for (const savingsTarget of savingsTargets) {
      options.push({
        key: `savings:${savingsTarget.id}`,
        id: savingsTarget.id,
        kind: "savings",
        accountNumber: savingsTarget.accountNumber,
        currencyCode: savingsTarget.currencyCode,
        label: `${savingsTarget.productName} \u00b7 ${savingsTarget.accountNumber}${savingsTarget.isDefault ? " \u00b7 default" : ""}`,
        hint: "Posts a normal deposit or withdrawal on this savings account.",
      });
    }
    for (const loan of loanTargets) {
      const outstanding = formatMinor(BigInt(loan.outstandingMinor), loan.currencyCode);
      const overdue = BigInt(loan.overdueMinor);
      options.push({
        key: `loan:${loan.id}`,
        id: loan.id,
        kind: "loan",
        accountNumber: loan.accountNumber,
        currencyCode: loan.currencyCode,
        label: `${loan.accountNumber} · ${loan.productName}`,
        hint: overdue > 0n ? `${formatMinor(overdue, loan.currencyCode)} overdue · ${outstanding} outstanding` : `${outstanding} outstanding · ${loan.status.replaceAll("_", " ")}`,
      });
    }
    return options;
  }, [loanTargets, savingsTargets]);
  // When locked to savings-only (Top up / Withdraw), the selectable list excludes loans entirely
  // -- otherwise every option (savings accounts + open loans) is selectable, as in Record payment.
  const selectableOptions = useMemo(
    () => (lockTarget ? targetOptions.filter((option) => option.kind === "savings") : targetOptions),
    [lockTarget, targetOptions],
  );
  const defaultSavingsTarget = useMemo(() => savingsTargets.find((account) => account.isDefault) ?? savingsTargets[0] ?? null, [savingsTargets]);
  const defaultTargetKey = useMemo(() => {
    if (initialTargetKey && selectableOptions.some((option) => option.key === initialTargetKey)) return initialTargetKey;
    if (lockTarget) return defaultSavingsTarget ? `savings:${defaultSavingsTarget.id}` : "";
    const overdueLoan = loanTargets.find((loan) => BigInt(loan.overdueMinor) > 0n);
    if (overdueLoan) return `loan:${overdueLoan.id}`;
    if (defaultSavingsTarget) return `savings:${defaultSavingsTarget.id}`;
    return loanTargets[0] ? `loan:${loanTargets[0].id}` : "";
  }, [defaultSavingsTarget, initialTargetKey, lockTarget, loanTargets, selectableOptions]);
  const [targetKey, setTargetKey] = useState(defaultTargetKey);
  const selectedTarget = selectableOptions.find((option) => option.key === targetKey) ?? selectableOptions[0] ?? null;
  const compatibleSettlementAccounts = useMemo(() => {
    const compatible = settlementAccounts.filter((account) => !selectedTarget || account.currencyCode === selectedTarget.currencyCode);
    // Cash is the most common payment method in practice, so it's pre-selected over whatever
    // bank/mobile-money account happens to be listed first (still changeable in the dropdown).
    const cashFirst = compatible.find((account) => account.type === "CASH");
    return cashFirst ? [cashFirst, ...compatible.filter((account) => account.id !== cashFirst.id)] : compatible;
  }, [selectedTarget, settlementAccounts]);
  const [settlementAccountId, setSettlementAccountId] = useState(compatibleSettlementAccounts[0]?.id ?? "");

  useEffect(() => {
    if (!selectableOptions.some((option) => option.key === targetKey)) setTargetKey(defaultTargetKey);
  }, [defaultTargetKey, selectableOptions, targetKey]);

  useEffect(() => {
    if (!compatibleSettlementAccounts.some((account) => account.id === settlementAccountId)) {
      setSettlementAccountId(compatibleSettlementAccounts[0]?.id ?? "");
    }
  }, [compatibleSettlementAccounts, settlementAccountId]);

  async function transact(type: "DEPOSIT" | "WITHDRAWAL") {
    const amountMinor = parseAmountToMinor(amount);
    if (!amountMinor || BigInt(amountMinor) <= 0n) { toast.error("Enter a valid amount"); return; }
    if (!selectedTarget) { toast.error("No transaction target is available"); return; }
    if (!settlementAccountId) { toast.error("Select a payment method"); return; }
    if (type === "WITHDRAWAL" && selectedTarget.kind !== "savings") { toast.error("Withdrawals can only be recorded against the savings account"); return; }
    setPending(type);
    const trimmedReason = reason.trim();
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = selectedTarget.kind === "loan" && type === "DEPOSIT"
        ? await fetch(`/api/loans/${selectedTarget.id}/repayments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amountMinor,
              settlementAccountId,
              businessDate: new Date().toISOString().slice(0, 10),
              externalReference: trimmedReason || undefined,
              idempotencyKey,
            }),
          })
        : await fetch(`/api/clients/${clientId}/savings-accounts/${selectedTarget.id}/transactions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type,
              amount: Number(amount),
              settlementAccountId,
              reason: trimmedReason || undefined,
              idempotencyKey,
            }),
          });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(
          result.error ??
            (selectedTarget.kind === "loan"
              ? "Could not record this loan repayment"
              : type === "DEPOSIT"
                ? "Could not record this savings deposit"
                : "Could not record this savings withdrawal"),
        );
        return;
      }
      toast.success(
        type === "DEPOSIT" && selectedTarget.kind === "loan"
          ? `Repayment recorded on loan ${selectedTarget.accountNumber}`
          : type === "DEPOSIT"
            ? `Deposit recorded on savings account ${selectedTarget.accountNumber}`
            : `Withdrawal recorded on savings account ${selectedTarget.accountNumber}`,
      );
      setAmount("");
      setReason("");
      router.refresh();
      onSuccess?.();
    } catch {
      toast.error(selectedTarget?.kind === "loan" ? "Could not record this loan repayment" : type === "DEPOSIT" ? "Could not record this savings deposit" : "Could not record this savings withdrawal");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="account-card-form">
      <div className="form-row">
        <label>Amount<input inputMode="decimal" min={1} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" step="0.01" type="number" value={amount} /></label>
        <label>Payment method<select disabled={compatibleSettlementAccounts.length === 0} onChange={(event) => setSettlementAccountId(event.target.value)} value={settlementAccountId}><option value="" disabled>Select settlement account</option>{compatibleSettlementAccounts.map((account) => <option key={account.id} value={account.id}>{settlementLabel(account)}</option>)}</select></label>
      </div>
      <div className="form-row">
        {selectableOptions.length > 1 ? <label>{lockTarget ? "Savings account" : "Deposit target"}<select onChange={(event) => setTargetKey(event.target.value)} value={selectedTarget?.key ?? ""}>{selectableOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label> : <label>Account<input disabled readOnly value={selectedTarget?.label ?? ""} /></label>}
        <label>Recorded by<input disabled readOnly value={currentUserName} /></label>
      </div>
      <label>Reason / note<input maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Member savings top-up" value={reason} /></label>
      {selectedTarget ? <p className="field-help">{selectedTarget.hint}</p> : null}
      {compatibleSettlementAccounts.length === 0 && selectedTarget ? <aside className="configuration-note"><strong>Settlement setup required</strong><span>Add an active {selectedTarget.currencyCode} settlement account in Backoffice → Accounting mappings before recording this transaction.</span></aside> : null}
      <div className="account-card-actions">
        {allowedActions.includes("DEPOSIT") ? <BrandActionButton disabled={pending !== null || compatibleSettlementAccounts.length === 0 || !selectedTarget} icon={pending === "DEPOSIT" ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} onClick={() => transact("DEPOSIT")} type="button">{selectedTarget?.kind === "loan" ? "Apply to loan" : "Deposit"}</BrandActionButton> : null}
        {allowedActions.includes("WITHDRAWAL") ? <button className="secondary-action" disabled={pending !== null || compatibleSettlementAccounts.length === 0 || selectedTarget?.kind !== "savings"} onClick={() => transact("WITHDRAWAL")} type="button">{pending === "WITHDRAWAL" ? <LoaderCircle className="spin" size={15} /> : <Minus size={15} />} Withdraw</button> : null}
      </div>
    </div>
  );
}

export type TransferSourceAccount = Readonly<{
  id: string;
  accountNumber: string;
  currencyCode: string;
  // The savings product name (e.g. "Member Savings Account") -- shown ahead of the account
  // number so an operator picks the right kind of account, not just a bare number.
  productName: string;
  balanceMinor: string;
}>;

/**
 * Internal transfer: moves money from the client's own savings balance straight onto a loan,
 * with no settlement account and no cash leaving the institution -- see
 * transferSavingsToLoan() in post-repayment.ts for the accounting treatment. Deliberately kept
 * separate from DepositWithdrawForm since it posts to a dedicated endpoint and has no payment
 * method to choose.
 */
export function TransferToLoanForm({
  savingsAccounts,
  loanTargets,
  onSuccess,
}: {
  savingsAccounts: readonly TransferSourceAccount[];
  loanTargets: readonly LoanDepositTarget[];
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [savingsAccountId, setSavingsAccountId] = useState(savingsAccounts[0]?.id ?? "");
  const defaultLoanId = useMemo(() => {
    const overdueLoan = loanTargets.find((loan) => BigInt(loan.overdueMinor) > 0n);
    return overdueLoan?.id ?? loanTargets[0]?.id ?? "";
  }, [loanTargets]);
  const [loanId, setLoanId] = useState(defaultLoanId);
  const source = savingsAccounts.find((account) => account.id === savingsAccountId) ?? null;
  const destination = loanTargets.find((loan) => loan.id === loanId) ?? null;

  async function transfer() {
    const amountMinor = parseAmountToMinor(amount);
    if (!amountMinor || BigInt(amountMinor) <= 0n) { toast.error("Enter a valid amount"); return; }
    if (!source) { toast.error("Select a savings account to transfer from"); return; }
    if (!destination) { toast.error("Select a loan to pay down"); return; }
    if (BigInt(amountMinor) > BigInt(source.balanceMinor)) { toast.error("Amount exceeds the available savings balance"); return; }
    setPending(true);
    try {
      const response = await fetch(`/api/loans/${destination.id}/transfer-from-savings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savingsAccountId: source.id,
          amountMinor,
          businessDate: new Date().toISOString().slice(0, 10),
          externalReference: reason.trim() || undefined,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { toast.error(result.error ?? "Could not transfer savings to this loan"); return; }
      toast.success(`Transferred to loan ${destination.accountNumber} from savings ${source.accountNumber}`);
      setAmount("");
      setReason("");
      router.refresh();
      onSuccess?.();
    } catch {
      toast.error("Could not transfer savings to this loan");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="account-card-form">
      <div className="form-row">
        <label>From savings<select onChange={(event) => setSavingsAccountId(event.target.value)} value={savingsAccountId}>{savingsAccounts.map((account) => <option key={account.id} value={account.id}>{`${account.productName} \u00b7 ${account.accountNumber} \u00b7 ${formatMinor(BigInt(account.balanceMinor), account.currencyCode)}`}</option>)}</select></label>
        <label>To loan<select onChange={(event) => setLoanId(event.target.value)} value={loanId}>{loanTargets.map((loan) => <option key={loan.id} value={loan.id}>{`${loan.accountNumber} \u00b7 ${loan.productName}`}</option>)}</select></label>
      </div>
      <label>Amount<input inputMode="decimal" min={1} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" step="0.01" type="number" value={amount} /></label>
      <label>Reason / note<input maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Clearing overdue installment from savings" value={reason} /></label>
      {source ? <p className="field-help">Available balance: {formatMinor(BigInt(source.balanceMinor), source.currencyCode)}</p> : null}
      {destination ? <p className="field-help">{BigInt(destination.overdueMinor) > 0n ? `${formatMinor(BigInt(destination.overdueMinor), destination.currencyCode)} overdue \u00b7 ${formatMinor(BigInt(destination.outstandingMinor), destination.currencyCode)} outstanding` : `${formatMinor(BigInt(destination.outstandingMinor), destination.currencyCode)} outstanding`}</p> : null}
      <div className="account-card-actions">
        <BrandActionButton disabled={pending || !source || !destination} icon={pending ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} onClick={transfer} type="button">Transfer to loan</BrandActionButton>
      </div>
    </div>
  );
}

/**
 * Internal transfer between two of a member's own savings sub-accounts (e.g. personal <->
 * group-linked). See transferSavingsToSavings() in transfer-savings.ts for the accounting
 * treatment. Needs at least two active savings accounts to be usable at all.
 */
export function TransferToSavingsForm({
  savingsAccounts,
  onSuccess,
}: {
  savingsAccounts: readonly TransferSourceAccount[];
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [fromId, setFromId] = useState(savingsAccounts[0]?.id ?? "");
  const [toId, setToId] = useState(savingsAccounts[1]?.id ?? "");
  const source = savingsAccounts.find((account) => account.id === fromId) ?? null;
  const destinationOptions = savingsAccounts.filter((account) => account.id !== fromId);
  const destination = destinationOptions.find((account) => account.id === toId) ?? destinationOptions[0] ?? null;

  function selectFrom(nextFromId: string) {
    setFromId(nextFromId);
    const stillValid = savingsAccounts.some((account) => account.id !== nextFromId && account.id === toId);
    if (!stillValid) {
      setToId(savingsAccounts.find((account) => account.id !== nextFromId)?.id ?? "");
    }
  }

  async function transfer() {
    const amountMinor = parseAmountToMinor(amount);
    if (!amountMinor || BigInt(amountMinor) <= 0n) { toast.error("Enter a valid amount"); return; }
    if (!source) { toast.error("Select a savings account to transfer from"); return; }
    if (!destination) { toast.error("Select a savings account to transfer to"); return; }
    if (BigInt(amountMinor) > BigInt(source.balanceMinor)) { toast.error("Amount exceeds the available savings balance"); return; }
    setPending(true);
    try {
      const response = await fetch(`/api/savings-accounts/${source.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toSavingsAccountId: destination.id,
          amountMinor,
          businessDate: new Date().toISOString().slice(0, 10),
          externalReference: reason.trim() || undefined,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { toast.error(result.error ?? "Could not transfer between these savings accounts"); return; }
      toast.success(`Transferred from ${source.accountNumber} to ${destination.accountNumber}`);
      setAmount("");
      setReason("");
      router.refresh();
      onSuccess?.();
    } catch {
      toast.error("Could not transfer between these savings accounts");
    } finally {
      setPending(false);
    }
  }

  if (savingsAccounts.length < 2) {
    return <p className="field-help">This client needs at least two active savings accounts to transfer between them.</p>;
  }

  return (
    <div className="account-card-form">
      <div className="form-row">
        <label>From savings<select onChange={(event) => selectFrom(event.target.value)} value={fromId}>{savingsAccounts.map((account) => <option key={account.id} value={account.id}>{`${account.productName} \u00b7 ${account.accountNumber} \u00b7 ${formatMinor(BigInt(account.balanceMinor), account.currencyCode)}`}</option>)}</select></label>
        <label>To savings<select onChange={(event) => setToId(event.target.value)} value={destination?.id ?? ""}>{destinationOptions.map((account) => <option key={account.id} value={account.id}>{`${account.productName} \u00b7 ${account.accountNumber} \u00b7 ${formatMinor(BigInt(account.balanceMinor), account.currencyCode)}`}</option>)}</select></label>
      </div>
      <label>Amount<input inputMode="decimal" min={1} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" step="0.01" type="number" value={amount} /></label>
      <label>Reason / note<input maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Moving savings between accounts" value={reason} /></label>
      {source ? <p className="field-help">Available balance: {formatMinor(BigInt(source.balanceMinor), source.currencyCode)}</p> : null}
      <div className="account-card-actions">
        <BrandActionButton disabled={pending || !source || !destination} icon={pending ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} onClick={transfer} type="button">Transfer between savings</BrandActionButton>
      </div>
    </div>
  );
}

/**
 * Single "Transfer" entry point shown ahead of Record payment / Top up / Withdraw. Toggles
 * between the two internal-transfer flows above: moving money between the client's own savings
 * sub-accounts, or straight onto one of their loans as a repayment (never a generic balance move
 * -- see TransferToLoanForm). Hidden entirely when neither flow has enough targets to be useful.
 */
export function TransferForm({
  savingsAccounts,
  loanTargets,
  canTransferToLoan,
  onSuccess,
}: {
  savingsAccounts: readonly TransferSourceAccount[];
  loanTargets: readonly LoanDepositTarget[];
  canTransferToLoan: boolean;
  onSuccess?: () => void;
}) {
  const canTransferToSavings = savingsAccounts.length >= 2;
  const canTransferToLoanNow = canTransferToLoan && savingsAccounts.length > 0 && loanTargets.length > 0;
  const [mode, setMode] = useState<"savings" | "loan">(canTransferToSavings ? "savings" : "loan");

  if (!canTransferToSavings && !canTransferToLoanNow) return null;

  return (
    <div className="account-card-form">
      {canTransferToSavings && canTransferToLoanNow ? (
        <div className="auth-tabs" role="tablist">
          <button className={mode === "savings" ? "auth-tab active" : "auth-tab"} onClick={() => setMode("savings")} role="tab" type="button">Between savings</button>
          <button className={mode === "loan" ? "auth-tab active" : "auth-tab"} onClick={() => setMode("loan")} role="tab" type="button">To a loan</button>
        </div>
      ) : null}
      {mode === "savings" && canTransferToSavings ? (
        <TransferToSavingsForm onSuccess={onSuccess} savingsAccounts={savingsAccounts} />
      ) : (
        <TransferToLoanForm loanTargets={loanTargets} onSuccess={onSuccess} savingsAccounts={savingsAccounts} />
      )}
    </div>
  );
}

export function ApproveSavingsAccountButton({ clientId, savingsAccountId }: { clientId: string; savingsAccountId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function approve() {
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/savings-accounts/${savingsAccountId}/approve`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not approve this savings account"); return; }
    toast.success("Savings account approved and ready for transactions");
    router.refresh();
  }

  return <button className="icon-action" disabled={pending} onClick={approve} title="Approve" type="button">{pending ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}</button>;
}

export function ApplyForLoanButton({ clientId }: { clientId: string }) {
  return <a className="invest-button" href={`/loans/new?clientId=${clientId}`}><Plus size={16} /> Add loan</a>;
}

export type ChargeRow = Readonly<{ id: string; name: string; amountFormatted: string; status: string; dueOnFormatted: string | null }>;

export function ChargesList({ clientId, charges, canManage }: { clientId: string; charges: readonly ChargeRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<{ chargeId: string; status: "PAID" | "WAIVED" } | null>(null);

  async function setStatus(chargeId: string, status: "PAID" | "WAIVED") {
    const confirmed = window.confirm(
      status === "PAID"
        ? "Mark this client charge as paid? Use this only when the charge has already been collected."
        : "Waive this client charge? The amount will no longer be due from the client.",
    );
    if (!confirmed) return;
    setPendingAction({ chargeId, status });
    const response = await fetch(`/api/clients/${clientId}/charges/${chargeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json().catch(() => ({}));
    setPendingAction(null);
    if (!response.ok) {
      toast.error(result.error ?? (status === "PAID" ? "Could not mark this client charge as paid" : "Could not waive this client charge"));
      return;
    }
    toast.success(status === "PAID" ? "Client charge marked as paid" : "Client charge waived");
    router.refresh();
  }

  if (charges.length === 0) return <div className="empty-state compact-empty"><strong>No charges recorded</strong><p>Fees and penalties applied to this client will appear here. Use the form below to add a one-off charge.</p></div>;

  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Charge</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {charges.map((charge) => (
            <tr key={charge.id}>
              <td>{charge.name}</td>
              <td className="mono">{charge.amountFormatted}</td>
              <td>{charge.dueOnFormatted ?? "\u2014"}</td>
              <td><span className={`status ${charge.status === "PAID" ? "up-to-date" : charge.status === "WAIVED" ? "review" : "in-arrears"}`}>{charge.status}</span></td>
              <td>{canManage && charge.status === "PENDING" ? (
                <div className="account-card-actions">
                  <button className="icon-action" disabled={pendingAction?.chargeId === charge.id} onClick={() => setStatus(charge.id, "PAID")} title="Mark paid" type="button">{pendingAction?.chargeId === charge.id && pendingAction.status === "PAID" ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}</button>
                  <button className="icon-action" disabled={pendingAction?.chargeId === charge.id} onClick={() => setStatus(charge.id, "WAIVED")} title="Waive" type="button">{pendingAction?.chargeId === charge.id && pendingAction.status === "WAIVED" ? <LoaderCircle className="spin" size={15} /> : <XCircle size={15} />}</button>
                </div>
              ) : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AddChargeForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/charges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formData.get("name"), amount: formData.get("amount"), dueOn: formData.get("dueOn") || undefined }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not add this client charge"); return; }
    toast.success("Charge added to the client record");
    router.refresh();
  }

  return <form action={submit} className="entity-form compact-mapping">
    <fieldset><legend>Add charge</legend><div className="form-row three"><label>Name<input name="name" placeholder="Processing fee" required /></label><label>Amount (UGX)<input min={1} name="amount" required step="0.01" type="number" /></label><label>Due date<input name="dueOn" type="date" /></label></div></fieldset>
    <div className="form-actions"><BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} type="submit">Add charge</BrandActionButton></div>
  </form>;
}

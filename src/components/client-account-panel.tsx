"use client";

import { CheckCircle2, LoaderCircle, Minus, Plus, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
  savingsTarget,
  loanTargets,
  initialTargetKey,
  onSuccess,
}: {
  clientId: string;
  currentUserName: string;
  settlementAccounts: readonly SettlementAccountOption[];
  savingsTarget: SavingsDepositTarget | null;
  loanTargets: readonly LoanDepositTarget[];
  // Pre-selects a target (e.g. "loan:<id>" or "savings:<id>") when this form is opened from a
  // purpose-built quick action (Repay loan / Top up) instead of the generic entry point.
  initialTargetKey?: string;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"DEPOSIT" | "WITHDRAWAL" | null>(null);
  const targetOptions = useMemo(() => {
    const options: Array<{ key: string; id: string; kind: "savings" | "loan"; accountNumber: string; currencyCode: string; label: string; hint: string }> = [];
    if (savingsTarget) {
      options.push({
        key: `savings:${savingsTarget.id}`,
        id: savingsTarget.id,
        kind: "savings",
        accountNumber: savingsTarget.accountNumber,
        currencyCode: savingsTarget.currencyCode,
        label: `Savings account · ${savingsTarget.accountNumber}`,
        hint: "Posts a normal deposit or withdrawal on the active savings account.",
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
  }, [loanTargets, savingsTarget]);
  const defaultTargetKey = useMemo(() => {
    if (initialTargetKey && targetOptions.some((option) => option.key === initialTargetKey)) return initialTargetKey;
    const overdueLoan = loanTargets.find((loan) => BigInt(loan.overdueMinor) > 0n);
    if (overdueLoan) return `loan:${overdueLoan.id}`;
    if (savingsTarget) return `savings:${savingsTarget.id}`;
    return loanTargets[0] ? `loan:${loanTargets[0].id}` : "";
  }, [initialTargetKey, loanTargets, savingsTarget, targetOptions]);
  const [targetKey, setTargetKey] = useState(defaultTargetKey);
  const selectedTarget = targetOptions.find((option) => option.key === targetKey) ?? targetOptions[0] ?? null;
  const compatibleSettlementAccounts = useMemo(
    () => settlementAccounts.filter((account) => !selectedTarget || account.currencyCode === selectedTarget.currencyCode),
    [selectedTarget, settlementAccounts],
  );
  const [settlementAccountId, setSettlementAccountId] = useState(compatibleSettlementAccounts[0]?.id ?? "");

  useEffect(() => {
    if (!targetOptions.some((option) => option.key === targetKey)) setTargetKey(defaultTargetKey);
  }, [defaultTargetKey, targetKey, targetOptions]);

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
        <label>Deposit target<select onChange={(event) => setTargetKey(event.target.value)} value={selectedTarget?.key ?? ""}>{targetOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <label>Recorded by<input disabled readOnly value={currentUserName} /></label>
      </div>
      <label>Reason / note<input maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Member savings top-up" value={reason} /></label>
      {selectedTarget ? <p className="field-help">{selectedTarget.hint}</p> : null}
      {compatibleSettlementAccounts.length === 0 && selectedTarget ? <aside className="configuration-note"><strong>Settlement setup required</strong><span>Add an active {selectedTarget.currencyCode} settlement account in Backoffice → Accounting mappings before recording this transaction.</span></aside> : null}
      <div className="account-card-actions">
        <button className="invest-button" disabled={pending !== null || compatibleSettlementAccounts.length === 0 || !selectedTarget} onClick={() => transact("DEPOSIT")} type="button">{pending === "DEPOSIT" ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} {selectedTarget?.kind === "loan" ? "Apply to loan" : "Deposit"}</button>
        <button className="secondary-action" disabled={pending !== null || compatibleSettlementAccounts.length === 0 || selectedTarget?.kind !== "savings"} onClick={() => transact("WITHDRAWAL")} type="button">{pending === "WITHDRAWAL" ? <LoaderCircle className="spin" size={15} /> : <Minus size={15} />} Withdraw</button>
      </div>
    </div>
  );
}

type TransferSourceAccount = Readonly<{
  id: string;
  accountNumber: string;
  currencyCode: string;
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
        <label>From savings<select onChange={(event) => setSavingsAccountId(event.target.value)} value={savingsAccountId}>{savingsAccounts.map((account) => <option key={account.id} value={account.id}>{`${account.accountNumber} \u00b7 ${formatMinor(BigInt(account.balanceMinor), account.currencyCode)}`}</option>)}</select></label>
        <label>To loan<select onChange={(event) => setLoanId(event.target.value)} value={loanId}>{loanTargets.map((loan) => <option key={loan.id} value={loan.id}>{`${loan.accountNumber} \u00b7 ${loan.productName}`}</option>)}</select></label>
      </div>
      <label>Amount<input inputMode="decimal" min={1} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" step="0.01" type="number" value={amount} /></label>
      <label>Reason / note<input maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Clearing overdue installment from savings" value={reason} /></label>
      {source ? <p className="field-help">Available balance: {formatMinor(BigInt(source.balanceMinor), source.currencyCode)}</p> : null}
      {destination ? <p className="field-help">{BigInt(destination.overdueMinor) > 0n ? `${formatMinor(BigInt(destination.overdueMinor), destination.currencyCode)} overdue \u00b7 ${formatMinor(BigInt(destination.outstandingMinor), destination.currencyCode)} outstanding` : `${formatMinor(BigInt(destination.outstandingMinor), destination.currencyCode)} outstanding`}</p> : null}
      <div className="account-card-actions">
        <button className="invest-button" disabled={pending || !source || !destination} onClick={transfer} type="button">{pending ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Transfer to loan</button>
      </div>
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
    <div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add charge</button></div>
  </form>;
}

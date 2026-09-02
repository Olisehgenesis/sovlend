"use client";

import { AlertTriangle, Check, LoaderCircle, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { formatMinor } from "@/modules/money/domain/format-minor";

type ServiceRequest = Readonly<{
  id: string;
  actionType: string;
  status: string;
  reason: string | null;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  isOwnRequest: boolean;
}>;

type PayoffQuote = Readonly<{
  totalPayoffMinor: string;
  principalOutstandingMinor: string;
  interestAccruedMinor: string;
  interestWaivedMinor: string;
  feesOutstandingMinor: string;
  penaltiesCollectedMinor: string;
  penaltiesWaivedMinor: string;
}>;

const actionLabels: Record<string, string> = {
  UNDO_DISBURSAL: "Undo disbursal",
  PREPAY: "Prepay loan",
  FORECLOSURE: "Foreclosure",
  TRANSACTION_REVERSAL: "Reverse transaction",
};

export function LoanServiceActionsPanel({
  loanId,
  canRequest,
  hasPendingDisbursement,
  isOpenLoan,
  settlementAccounts,
  repaymentTransactions,
  requests,
  currencyCode,
}: {
  loanId: string;
  canRequest: boolean;
  hasPendingDisbursement: boolean;
  isOpenLoan: boolean;
  settlementAccounts: ReadonlyArray<{ id: string; name: string; type: string }>;
  repaymentTransactions: ReadonlyArray<{ id: string; label: string }>;
  requests: readonly ServiceRequest[];
  currencyCode: string;
}) {
  const router = useRouter();
  const [actionType, setActionType] = useState("PREPAY");
  const [pendingCreate, setPendingCreate] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [quote, setQuote] = useState<PayoffQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const pendingRequest = requests.find((item) => item.status === "PENDING");

  async function previewPayoff(formData: FormData) {
    const businessDate = String(formData.get("businessDate") || new Date().toISOString().slice(0, 10));
    const waivePenalties = actionType === "FORECLOSURE" ? "true" : formData.get("waivePenalties") ? "true" : "false";
    setQuoting(true);
    const response = await fetch(`/api/loans/${loanId}/payoff-quote?businessDate=${businessDate}&waivePenalties=${waivePenalties}`);
    const result = await response.json().catch(() => ({}));
    setQuoting(false);
    if (!response.ok) { toast.error(result.error ?? "Could not compute payoff quote"); return; }
    setQuote(result);
  }

  async function createRequest(formData: FormData) {
    setPendingCreate(true);
    const payload: Record<string, unknown> = { businessDate: formData.get("businessDate") };
    if (actionType === "PREPAY" || actionType === "FORECLOSURE") {
      payload.settlementAccountId = formData.get("settlementAccountId");
      if (actionType === "PREPAY") payload.waivePenalties = Boolean(formData.get("waivePenalties"));
    }
    if (actionType === "TRANSACTION_REVERSAL") payload.transactionId = formData.get("transactionId");

    const response = await fetch(`/api/loans/${loanId}/service-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionType, reason: formData.get("reason") || undefined, payload, idempotencyKey: crypto.randomUUID() }),
    });
    const result = await response.json().catch(() => ({}));
    setPendingCreate(false);
    if (!response.ok) { toast.error(result.error ?? "Servicing request could not be submitted"); return; }
    toast.success("Servicing action submitted for approval");
    setQuote(null);
    router.refresh();
  }

  async function decide(requestId: string, decision: "APPROVE" | "REJECT") {
    setDecidingId(requestId);
    const response = await fetch(`/api/loans/${loanId}/service-actions/${requestId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const result = await response.json().catch(() => ({}));
    setDecidingId(null);
    if (!response.ok) { toast.error(result.error ?? "Decision could not be recorded"); return; }
    toast.success(decision === "APPROVE" ? "Servicing action approved and executed" : "Servicing action rejected");
    router.refresh();
  }

  return (
    <>
      <aside className="configuration-note">
        <strong><ShieldAlert size={14} /> Maker-checker required</strong>
        <span>High-risk actions must be requested by one user and approved by a different user before they take effect.</span>
      </aside>
      {requests.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>No servicing actions requested</strong>
          <p>Undo disbursal, prepay, foreclosure, and transaction reversal requests will appear here.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Decided by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((item) => (
                <tr key={item.id}>
                  <td>
                    {actionLabels[item.actionType] ?? item.actionType}
                    {item.reason ? <p className="muted-text">{item.reason}</p> : null}
                  </td>
                  <td>
                    <span className={`status ${item.status === "APPROVED" ? "up-to-date" : item.status === "REJECTED" ? "in-arrears" : "review"}`}>{item.status}</span>
                  </td>
                  <td>{item.requestedByName}</td>
                  <td>{item.decidedByName ?? "-"}</td>
                  <td>
                    {item.canDecide ? (
                      <div className="account-card-actions">
                        <button className="icon-action" disabled={decidingId === item.id} onClick={() => decide(item.id, "APPROVE")} title="Approve and execute" type="button">
                          {decidingId === item.id ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                        </button>
                        <button className="icon-action" disabled={decidingId === item.id} onClick={() => decide(item.id, "REJECT")} title="Reject" type="button">
                          <X size={14} />
                        </button>
                      </div>
                    ) : item.isOwnRequest && item.status === "PENDING" ? (
                      <span className="muted-text">Awaiting a different approver</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canRequest && !pendingRequest ? (
        <form action={createRequest} className="entity-form compact-mapping">
          <fieldset>
            <legend>Request a servicing action</legend>
            <div className="form-row">
              <label>
                Action
                <select name="actionType" onChange={(event) => { setActionType(event.target.value); setQuote(null); }} value={actionType}>
                  <option disabled={!hasPendingDisbursement} value="UNDO_DISBURSAL">Undo disbursal</option>
                  <option disabled={!isOpenLoan} value="PREPAY">Prepay loan</option>
                  <option disabled={!isOpenLoan} value="FORECLOSURE">Foreclosure</option>
                  <option disabled={repaymentTransactions.length === 0} value="TRANSACTION_REVERSAL">Reverse transaction</option>
                </select>
              </label>
              <label>
                Business date
                <input defaultValue={new Date().toISOString().slice(0, 10)} name="businessDate" required type="date" />
              </label>
            </div>
            {actionType === "PREPAY" || actionType === "FORECLOSURE" ? (
              settlementAccounts.length === 0 ? (
                <aside className="configuration-note">
                  <strong>Settlement setup required</strong>
                  <span>Add a receiving account in Backoffice → Accounting mappings before settling this loan.</span>
                </aside>
              ) : (
                <label>
                  Settled into
                  <select name="settlementAccountId" required>
                    {settlementAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type.replaceAll("_", " ")}</option>)}
                  </select>
                </label>
              )
            ) : null}
            {actionType === "PREPAY" ? (
              <div className="check-row">
                <label>
                  <input name="waivePenalties" type="checkbox" /> Waive outstanding penalties
                </label>
              </div>
            ) : null}
            {actionType === "FORECLOSURE" ? (
              <aside className="configuration-note">
                <strong><AlertTriangle size={14} /> Note</strong>
                <span>Foreclosure always waives outstanding penalties and any interest not yet due.</span>
              </aside>
            ) : null}
            {actionType === "TRANSACTION_REVERSAL" ? (
              <label>
                Transaction to reverse
                <select name="transactionId" required>
                  {repaymentTransactions.map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.label}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              Reason
              <textarea maxLength={1000} name="reason" required rows={2} />
            </label>
          </fieldset>
          {(actionType === "PREPAY" || actionType === "FORECLOSURE") && isOpenLoan ? (
            <div className="form-actions">
              <button className="secondary-action" disabled={quoting} formAction={previewPayoff} type="submit">
                {quoting ? <LoaderCircle className="spin" size={16} /> : null} Preview payoff
              </button>
            </div>
          ) : null}
          {quote ? (
            <dl className="detail-grid payoff-quote">
              <div><dt>Principal</dt><dd>{formatMinor(BigInt(quote.principalOutstandingMinor), currencyCode)}</dd></div>
              <div><dt>Interest accrued</dt><dd>{formatMinor(BigInt(quote.interestAccruedMinor), currencyCode)}</dd></div>
              <div><dt>Interest waived</dt><dd>{formatMinor(BigInt(quote.interestWaivedMinor), currencyCode)}</dd></div>
              <div><dt>Fees</dt><dd>{formatMinor(BigInt(quote.feesOutstandingMinor), currencyCode)}</dd></div>
              <div><dt>Penalties collected</dt><dd>{formatMinor(BigInt(quote.penaltiesCollectedMinor), currencyCode)}</dd></div>
              <div><dt>Penalties waived</dt><dd>{formatMinor(BigInt(quote.penaltiesWaivedMinor), currencyCode)}</dd></div>
              <div className="payoff-total"><dt>Total payoff</dt><dd>{formatMinor(BigInt(quote.totalPayoffMinor), currencyCode)}</dd></div>
            </dl>
          ) : null}
          <div className="form-actions">
            <button className="invest-button" disabled={pendingCreate}>
              {pendingCreate ? <LoaderCircle className="spin" size={18} /> : null} Submit for approval
            </button>
          </div>
        </form>
      ) : null}
      {pendingRequest ? (
        <div className="empty-state compact-empty">
          <strong>A servicing action is already pending</strong>
          <p>Resolve the pending {actionLabels[pendingRequest.actionType] ?? pendingRequest.actionType} request above before submitting another.</p>
        </div>
      ) : null}
    </>
  );
}

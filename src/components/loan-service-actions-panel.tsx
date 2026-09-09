"use client";

import { AlertTriangle, Check, LoaderCircle, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Dialog, type DialogHandle } from "@/components/ui/dialog";
import { BrandActionButton } from "@/components/ui/brand-action-button";
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
  const dialogRef = useRef<DialogHandle>(null);
  const [actionType, setActionType] = useState("PREPAY");
  const [pendingCreate, setPendingCreate] = useState(false);
  const [deciding, setDeciding] = useState<{ requestId: string; decision: "APPROVE" | "REJECT" } | null>(null);
  const [quote, setQuote] = useState<PayoffQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  const pendingRequest = requests.find((item) => item.status === "PENDING");

  function actionLabel(action: string) {
    return actionLabels[action] ?? action;
  }

  function resetRequestDialog() {
    setActionType("PREPAY");
    setQuote(null);
    setFormVersion((current) => current + 1);
  }

  function closeRequestDialog() {
    dialogRef.current?.close();
  }

  async function previewPayoff(formData: FormData) {
    const businessDate = String(formData.get("businessDate") || new Date().toISOString().slice(0, 10));
    const waivePenalties = actionType === "FORECLOSURE" ? "true" : formData.get("waivePenalties") ? "true" : "false";
    setQuoting(true);
    const response = await fetch(`/api/loans/${loanId}/payoff-quote?businessDate=${businessDate}&waivePenalties=${waivePenalties}`);
    const result = await response.json().catch(() => ({}));
    setQuoting(false);
    if (!response.ok) { toast.error(result.error ?? "Could not preview this payoff amount"); return; }
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
    if (!response.ok) { toast.error(result.error ?? `Could not submit the ${actionLabel(actionType).toLowerCase()} request`); return; }
    toast.success(`${actionLabel(actionType)} request submitted for approval`);
    closeRequestDialog();
    router.refresh();
  }

  async function decide(requestId: string, decision: "APPROVE" | "REJECT") {
    const request = requests.find((item) => item.id === requestId);
    const label = actionLabel(request?.actionType ?? "servicing action");
    const confirmed = window.confirm(
      decision === "APPROVE"
        ? `Approve and execute the ${label.toLowerCase()} request?`
        : `Reject the ${label.toLowerCase()} request? The request will remain in the audit trail.`,
    );
    if (!confirmed) return;
    setDeciding({ requestId, decision });
    const response = await fetch(`/api/loans/${loanId}/service-actions/${requestId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const result = await response.json().catch(() => ({}));
    setDeciding(null);
    if (!response.ok) { toast.error(result.error ?? (decision === "APPROVE" ? `Could not approve the ${label.toLowerCase()} request` : `Could not reject the ${label.toLowerCase()} request`)); return; }
    toast.success(decision === "APPROVE" ? `${label} approved and executed` : `${label} request rejected`);
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
          <table className="clickable-rows">
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
                    <strong>{actionLabel(item.actionType)}</strong>
                    {item.reason ? <p className="muted-text">{item.reason}</p> : null}
                    <Link className="row-link" href={`/loans/${loanId}/servicing/${item.id}`} aria-label={`Open ${actionLabel(item.actionType)} request`} />
                  </td>
                  <td>
                    <span className={`status ${item.status === "APPROVED" ? "up-to-date" : item.status === "REJECTED" ? "in-arrears" : "review"}`}>{item.status}</span>
                  </td>
                  <td>{item.requestedByName}</td>
                  <td>{item.decidedByName ?? "-"}</td>
                  <td style={{ position: "relative", zIndex: 1 }}>
                    {item.canDecide ? (
                      <div className="account-card-actions">
                        <button className="icon-action" disabled={deciding?.requestId === item.id} onClick={() => decide(item.id, "APPROVE")} title="Approve and execute" type="button">
                          {deciding?.requestId === item.id && deciding.decision === "APPROVE" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                        </button>
                        <button className="icon-action" disabled={deciding?.requestId === item.id} onClick={() => decide(item.id, "REJECT")} title="Reject" type="button">
                          {deciding?.requestId === item.id && deciding.decision === "REJECT" ? <LoaderCircle className="spin" size={14} /> : <X size={14} />}
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
        <>
          <div className="form-actions">
            <BrandActionButton onClick={() => dialogRef.current?.showModal()} type="button">
              Request servicing action
            </BrandActionButton>
          </div>
          <Dialog onClose={resetRequestDialog} ref={dialogRef} title="Request a servicing action">
            <form action={createRequest} className="entity-form compact-mapping" key={formVersion}>
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
                <BrandActionButton disabled={pendingCreate} icon={pendingCreate ? <LoaderCircle className="spin" size={18} /> : undefined} type="submit">
                  Submit for approval
                </BrandActionButton>
              </div>
            </form>
          </Dialog>
        </>
      ) : null}
      {pendingRequest ? (
        <div className="empty-state compact-empty">
          <strong>A servicing action is already pending</strong>
          <p>Resolve the pending {actionLabel(pendingRequest.actionType)} request above before submitting another.</p>
        </div>
      ) : null}
    </>
  );
}

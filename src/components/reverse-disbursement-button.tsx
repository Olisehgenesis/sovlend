"use client";

import { ArrowLeftRight, LoaderCircle, X } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function ReverseDisbursementButton({
  loanId,
  disabled = false,
  disabledReason,
}: {
  loanId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/service-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionType: "UNDO_DISBURSAL",
        reason: formData.get("reason") || undefined,
        payload: { businessDate: formData.get("businessDate") },
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Reverse disbursement request could not be submitted");
      return;
    }
    toast.success("Reverse disbursement request submitted for checker approval");
    dialogRef.current?.close();
    router.refresh();
  }

  return (
    <>
      <button
        className="secondary-action"
        disabled={disabled}
        onClick={() => dialogRef.current?.showModal()}
        title={disabledReason}
        type="button"
      >
        <ArrowLeftRight size={16} /> Reverse disbursement
      </button>
      <dialog className="app-modal" ref={dialogRef}>
        <div className="app-modal-heading">
          <h2>Reverse disbursement</h2>
          <button
            aria-label="Close"
            className="icon-action"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <form action={submit} className="entity-form compact-mapping">
          <fieldset>
            <legend>Submit for approval</legend>
            <p className="field-help">
              This creates a maker-checker request. A different approver must still review and
              execute the reversal.
            </p>
            <label>
              Business date
              <input
                defaultValue={new Date().toISOString().slice(0, 10)}
                name="businessDate"
                required
                type="date"
              />
            </label>
            <label>
              Reason
              <textarea maxLength={1000} name="reason" rows={3} />
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="invest-button" disabled={pending}>
              {pending ? <LoaderCircle className="spin" size={18} /> : <ArrowLeftRight size={18} />}{" "}
              Submit request
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

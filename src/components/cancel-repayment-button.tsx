"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";
import { Dialog, type DialogHandle } from "@/components/ui/dialog";

export function CancelRepaymentButton({
  loanId,
  transactionId,
}: {
  loanId: string;
  transactionId: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<DialogHandle>(null);
  const [pending, setPending] = useState(false);

  async function submitRequest(formData: FormData) {
    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/service-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionType: "TRANSACTION_REVERSAL",
        reason: formData.get("reason"),
        payload: {
          transactionId,
          businessDate: formData.get("businessDate"),
        },
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not request repayment cancellation");
      return;
    }
    toast.success("Repayment cancellation submitted for approval");
    dialogRef.current?.close();
    router.refresh();
  }

  return (
    <>
      <button
        className="secondary-action"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <RotateCcw size={15} /> Request cancellation
      </button>
      <Dialog ref={dialogRef} title="Request repayment cancellation">
        <form action={submitRequest} className="entity-form compact-mapping">
          <p>
            The original payment will stay in the audit trail. If approved, a
            reversal will remove it from the loan balance and payment totals.
          </p>
          <label>
            Cancellation date
            <input
              defaultValue={new Date().toISOString().slice(0, 10)}
              name="businessDate"
              required
              type="date"
            />
          </label>
          <label>
            Reason
            <textarea maxLength={1000} name="reason" required rows={2} />
          </label>
          <div className="form-actions">
            <BrandActionButton
              disabled={pending}
              icon={pending ? <LoaderCircle className="spin" size={18} /> : undefined}
              type="submit"
            >
              Submit for approval
            </BrandActionButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

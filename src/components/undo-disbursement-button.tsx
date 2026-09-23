"use client";

import { LoaderCircle, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Dialog, type DialogHandle } from "@/components/ui/dialog";
import { BrandActionButton } from "@/components/ui/brand-action-button";

export function UndoDisbursementButton({ loanId }: { loanId: string }) {
  const router = useRouter();
  const dialogRef = useRef<DialogHandle>(null);
  const [pending, setPending] = useState(false);

  async function undo(formData: FormData) {
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) {
      toast.error("Give a reason before undoing this disbursement");
      return;
    }
    setPending(true);
    const response = await fetch(`/api/loans/${loanId}/undo-disbursement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessDate: formData.get("businessDate") || new Date().toISOString().slice(0, 10),
        reason,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Could not undo this disbursement");
      return;
    }
    toast.success("Disbursement undone. The loan is approved again and can be redisbursed.");
    dialogRef.current?.close();
    router.refresh();
  }

  return (
    <>
      <BrandActionButton icon={<Undo2 size={16} />} onClick={() => dialogRef.current?.showModal()} type="button" variant="gold">
        Undo disbursement
      </BrandActionButton>
      <Dialog ref={dialogRef} title="Undo disbursement">
        <form action={undo} className="entity-form compact-mapping">
          <fieldset>
            <legend>Undo disbursement</legend>
            <p className="field-help">
              This reverses the disbursement journals and savings credits as long as the member has not cashed out the proceeds. The loan returns to approved so it can be disbursed again.
            </p>
            <label>
              Business date
              <input defaultValue={new Date().toISOString().slice(0, 10)} name="businessDate" required type="date" />
            </label>
            <label>
              Reason
              <textarea maxLength={1000} name="reason" placeholder="Why this disbursement should be reversed" required rows={3} />
            </label>
          </fieldset>
          <div className="form-actions">
            <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Undo2 size={16} />} type="submit" variant="gold">
              Undo disbursement
            </BrandActionButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

"use client";

import { Lock, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

type Office = { id: string; name: string };

export function AccountingClosureForm({ offices }: { offices: Office[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/accounting/closures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId: formData.get("officeId"),
        closingDate: formData.get("closingDate"),
        comment: formData.get("comment") || undefined,
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Closing entry could not be created");
      return;
    }
    toast.success("Accounting period closed");
    router.refresh();
  }

  return (
    <form action={submit} className="entity-form compact-mapping">
      <fieldset>
        <legend>New closing entry</legend>
        <label>
          Office
          <select name="officeId" required defaultValue="">
            <option value="" disabled>
              Select an office
            </option>
            {offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Closed as of
          <input type="date" name="closingDate" required />
        </label>
        <label>
          Comment
          <input name="comment" maxLength={300} placeholder="Optional note, e.g. reason for closing" />
        </label>
        <p className="field-hint">
          Locks postings dated on or before this date for the selected office. This cannot be undone or reopened from here.
        </p>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <Lock size={18} />} type="submit">
          Close period
        </BrandActionButton>
      </div>
    </form>
  );
}

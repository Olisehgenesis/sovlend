"use client";

import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

export function PostProvisioningEntryForm({
  officeId,
  offices,
  defaultsConfigured,
}: {
  officeId: string | null;
  offices: Array<{ id: string; name: string }>;
  defaultsConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/accounting/provisioning-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId: formData.get("officeId"),
        asOfDate: formData.get("asOfDate"),
        narration: formData.get("narration") || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Provisioning entry could not be posted");
      return;
    }
    if (result.alreadyPosted) {
      toast.success("Already posted for this office and date");
    } else if (result.posting?.journalId) {
      toast.success(`Posted (delta ${result.posting.deltaMinor})`);
    } else {
      toast.success("No change in required provision -- nothing to post");
    }
    router.push("/reports/accounting/journal-reconciliation");
    router.refresh();
  }

  if (!defaultsConfigured) {
    return (
      <aside className="configuration-note">
        <strong>Provisioning accounts not configured</strong>
        <span>Ask a super-admin to set the provision expense and loan loss provision accounts under Accounting mappings before posting.</span>
      </aside>
    );
  }

  return (
    <form action={submit} className="entity-form compact-mapping">
      <fieldset>
        <legend>Provisioning entry</legend>
        <p className="field-hint">
          Posts the change in required loan-loss provision (from the current PAR-aging report) for this office since its last posting. Posting the
          same office and date twice has no additional effect.
        </p>
        <div className="form-row">
          <label>
            Office
            <select name="officeId" required defaultValue={officeId ?? offices[0]?.id ?? ""}>
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            As of date
            <input name="asOfDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </label>
        </div>
        <label>
          Description (optional)
          <input name="narration" maxLength={200} placeholder="e.g. Monthly loan loss provision adjustment" />
        </label>
      </fieldset>
      <div className="form-actions">
        <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={18} /> : <ShieldAlert size={18} />} type="submit">
          Post provisioning entry
        </BrandActionButton>
      </div>
    </form>
  );
}

"use client";

import { Database, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function ImportLegacyClientForm({ offices }: { offices: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function importClient(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/backoffice/clients/import-legacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legacyClientId: Number(formData.get("legacyClientId")), officeId: formData.get("officeId") }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Import failed"); return; }
    toast.success(`Imported client ${result.accountNumber} (${result.familyMembersImported} family, ${result.identifiersImported} identities, ${result.documentsImported} documents)`);
    router.push(`/clients/${result.accountNumber}`);
  }

  return <article className="panel migration-status"><div className="panel-heading"><div><h2>Import client from legacy iLend</h2><p>Pulls one client&apos;s profile, family, identities, notes and documents</p></div><Database size={18} /></div><form action={importClient} className="entity-form compact-mapping"><div className="form-row"><label>Legacy client #<input inputMode="numeric" name="legacyClientId" required type="number" /></label><label>Office<select name="officeId" required>{offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label></div><div className="form-actions"><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Database size={16} />} Import client</button></div></form></article>;
}

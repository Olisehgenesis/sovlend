"use client";

import { Archive, ArchiveRestore, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

// Archiving a product never deletes it - existing accounts keep their terms snapshot regardless of product state.
export function ArchiveToggleButton({ url, active }: { url: string; active: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (active && !window.confirm("Archive this product? It stays in the database and won't affect accounts already opened against it.")) return;
    setPending(true);
    const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active }) });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Update failed"); return; }
    toast.success(active ? "Product archived" : "Product restored");
    router.refresh();
  }

  return (
    <button className={`icon-action ${active ? "danger" : ""}`} disabled={pending} onClick={toggle} title={active ? "Archive (soft delete)" : "Restore"} type="button">
      {pending ? <LoaderCircle className="spin" size={14} /> : active ? <Archive size={14} /> : <ArchiveRestore size={14} />}
    </button>
  );
}

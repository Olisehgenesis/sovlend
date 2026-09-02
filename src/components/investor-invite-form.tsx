"use client";

import { Link2, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function InvestorInviteForm({ organizations }: { organizations: Array<{ id: string; name: string }> }) {
  const [pending, setPending] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function create(formData: FormData) {
    setPending(true);
    setInviteUrl(null);
    const response = await fetch("/api/investor/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Invite could not be created");
      return;
    }
    setInviteUrl(result.inviteUrl);
    toast.success("Secure investor link created");
  }

  async function copy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  }

  return <section className="panel invite-panel"><div className="panel-heading"><div><h2>Invite investor</h2><p>Single-use link, valid for 72 hours</p></div><Link2 size={18} /></div><form action={create} className="stack-form"><label>Business<select name="organizationId" required>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label><label>Investor email<input name="email" type="email" required /></label><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <Link2 size={18} />} Create invite link</button>{inviteUrl ? <button className="copy-link" type="button" onClick={copy}>{inviteUrl}</button> : null}</form></section>;
}
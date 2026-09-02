"use client";

import { Fingerprint, KeyRound, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

type PasskeySummary = { id: string; name?: string | null; deviceType: string; backedUp: boolean; createdAt?: Date | null };

export function PasskeySettings() {
  const [pending, setPending] = useState(false);
  const { data } = authClient.useListPasskeys();
  const passkeys: PasskeySummary[] = data ?? [];

  async function addPasskey() {
    setPending(true);
    const result = await authClient.passkey.addPasskey({ name: "SovLend passkey" });
    setPending(false);
    if (result.error) {
      toast.error(result.error.message ?? "Passkey could not be added");
      return;
    }
    toast.success("Passkey added");
  }

  return <main className="security-page"><section className="page-heading"><div><p className="eyebrow">Account security</p><h1>Passkeys</h1><p>Use your device biometrics, PIN or security key for phishing-resistant sign-in.</p></div><button className="primary" onClick={addPasskey} disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : <Fingerprint size={17} />} Add passkey</button></section><section className="panel passkey-list"><div className="panel-heading"><div><h2>Registered passkeys</h2><p>{passkeys.length} authenticator{passkeys.length === 1 ? "" : "s"}</p></div><KeyRound size={19} /></div>{passkeys.length === 0 ? <div className="empty-state"><Fingerprint size={28} /><strong>No passkeys registered</strong><p>Add one to sign in without typing your password.</p></div> : passkeys.map((key) => <div className="passkey-row" key={key.id}><Fingerprint size={19} /><span><strong>{key.name || "Passkey"}</strong><small>{key.deviceType} · {key.backedUp ? "Synced" : "Device only"}</small></span></div>)}</section></main>;
}
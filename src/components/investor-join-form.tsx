"use client";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function InvestorJoinForm({ token, email, organizationName }: { token: string; email: string; organizationName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function accept(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/investor/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name: formData.get("name"), password: formData.get("password") }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Invite could not be accepted");
      return;
    }
    toast.success("Investor account created");
    router.replace("/sign-in");
  }

  return <main className="auth-page"><div className="auth-aside"><p className="eyebrow">Invitation to invest</p><strong>{organizationName}</strong><small>Your account tracks each contribution separately from business operating access.</small></div><div className="auth-card"><div className="auth-copy"><p className="eyebrow">Investor account</p><h1>Complete your account</h1><p>{email}</p></div><form action={accept} className="stack-form compact-form"><label>Full name<input name="name" required /></label><label>Password<input name="password" type="password" minLength={6} maxLength={128} autoComplete="new-password" required /></label><button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <UserPlus size={18} />} Create investor account</button></form></div></main>;
}
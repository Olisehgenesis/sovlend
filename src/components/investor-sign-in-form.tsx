"use client";

import { Fingerprint, LoaderCircle, LockKeyhole, Mail, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SovLendMark } from "@/components/sovlend-mark";

type Organization = { id: string; name: string };

export function InvestorSignInForm({ organizations }: { organizations: Organization[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [pending, setPending] = useState(false);

  async function signIn(formData: FormData) {
    setPending(true);
    const result = await authClient.signIn.email({
      email: String(formData.get("email")),
      password: String(formData.get("password")),
      callbackURL: "/investor",
    });
    setPending(false);

    if (result.error) {
      toast.error(result.error.message ?? "Sign-in failed");
      return;
    }

    toast.success("Signed in securely");
    router.replace("/investor");
    router.refresh();
  }

  async function signInWithPasskey() {
    setPending(true);
    const result = await authClient.signIn.passkey({ autoFill: false });
    setPending(false);

    if (result.error) {
      toast.error(result.error.message ?? "Passkey sign-in failed");
      return;
    }

    toast.success("Passkey verified");
    router.replace("/investor");
    router.refresh();
  }

  async function requestAccess(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/investor/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    const result = await response.json();
    setPending(false);

    if (!response.ok) {
      toast.error(result.error ?? "Request could not be sent");
      return;
    }

    toast.success("Request sent -- we'll email you an invite once it's approved");
  }

  return (
    <main className="auth-page">
      <div className="auth-aside">
        <p className="eyebrow">Invest with visibility</p>
        <strong>One login for every business you back. Track each contribution from invoice to settlement.</strong>
        <small>New investors are reviewed before their first invite goes out -- existing investors can sign in below with email, password, or a passkey.</small>
      </div>
      <div className="auth-card">
        <div className="auth-brand"><SovLendMark /><span>SovLend</span></div>
        <div className="auth-copy">
          <p className="eyebrow">Investor portal</p>
          <h1>{tab === "signin" ? "Sign in to invest" : "Request investor access"}</h1>
          <p>{tab === "signin" ? "Use the email, password, or passkey from your investor invite." : "Tell us which business you want to back -- we'll review and send an invite."}</p>
        </div>
        <div className="auth-tabs" role="tablist">
          <button className={tab === "signin" ? "auth-tab active" : "auth-tab"} onClick={() => setTab("signin")} role="tab" type="button">Sign in</button>
          <button className={tab === "signup" ? "auth-tab active" : "auth-tab"} onClick={() => setTab("signup")} role="tab" type="button">Sign up</button>
        </div>
        {tab === "signin" ? (
          <>
            <form action={signIn} className="auth-form">
              <label htmlFor="investor-email">Email address</label>
              <div className="auth-input"><Mail size={17} /><input id="investor-email" name="email" type="email" autoComplete="username webauthn" required /></div>
              <label htmlFor="investor-password">Password</label>
              <div className="auth-input"><LockKeyhole size={17} /><input id="investor-password" name="password" type="password" minLength={6} autoComplete="current-password webauthn" required /></div>
              <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : null} Sign in</button>
            </form>
            <div className="auth-divider"><span>or</span></div>
            <button className="passkey-button" disabled={pending} onClick={signInWithPasskey} type="button"><Fingerprint size={19} /> Sign in with a passkey</button>
          </>
        ) : (
          <form action={requestAccess} className="stack-form compact-form">
            <label>Business
              <select name="organizationId" required defaultValue="">
                <option value="" disabled>Select a business</option>
                {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Your name<input name="name" required /></label>
            <label>Email<input name="email" type="email" required /></label>
            <label>Message<textarea name="message" rows={3} /></label>
            <button className="invest-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />} Request investor access</button>
          </form>
        )}
        <p className="auth-footnote">Not an investor? <Link href="/sign-in">Sign in to your workspace</Link>.</p>
      </div>
    </main>
  );
}

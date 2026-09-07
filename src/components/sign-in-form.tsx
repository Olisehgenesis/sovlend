"use client";

import { Fingerprint, IdCard, LoaderCircle, LockKeyhole, Mail, Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SovLendMark } from "@/components/sovlend-mark";

export function SignInForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"staff" | "client">("staff");

  async function signInAsClient(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/auth/client-sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountNumber: String(formData.get("accountNumber")),
        mobileNumber: String(formData.get("mobileNumber")),
      }),
    });
    setPending(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      toast.error(payload?.error?.message ?? "Sign-in failed");
      return;
    }

    toast.success("Signed in securely");
    router.replace("/");
    router.refresh();
  }

  async function signInWithEmail(formData: FormData) {
    setPending(true);
    const result = await authClient.signIn.email({
      email: String(formData.get("email")),
      password: String(formData.get("password")),
      callbackURL: "/",
    });
    setPending(false);

    if (result.error) {
      toast.error(result.error.message ?? "Sign-in failed");
      return;
    }

    toast.success("Signed in securely");
    router.replace("/");
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
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="auth-brand"><SovLendMark /><span>SovLend</span></div>
      <div className="auth-copy"><p className="eyebrow">Secure operations</p><h1>Sign in to your workspace</h1><p>Use your work email, or sign in as a client with your account number.</p></div>
      <div className="auth-tabs" role="tablist">
        <button className={mode === "staff" ? "auth-tab active" : "auth-tab"} onClick={() => setMode("staff")} role="tab" type="button">Staff</button>
        <button className={mode === "client" ? "auth-tab active" : "auth-tab"} onClick={() => setMode("client")} role="tab" type="button">Client</button>
      </div>
      {mode === "staff" ? (
        <form action={signInWithEmail} className="auth-form">
          <label htmlFor="email">Email address</label>
          <div className="auth-input"><Mail size={17} /><input id="email" name="email" type="email" autoComplete="username webauthn" required /></div>
          <label htmlFor="password">Password</label>
          <div className="auth-input"><LockKeyhole size={17} /><input id="password" name="password" type="password" minLength={6} autoComplete="current-password webauthn" required /></div>
          <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : null} Sign in</button>
        </form>
      ) : (
        <form action={signInAsClient} className="auth-form">
          <label htmlFor="accountNumber">Account number</label>
          <div className="auth-input"><IdCard size={17} /><input id="accountNumber" name="accountNumber" type="text" autoComplete="username" required /></div>
          <label htmlFor="mobileNumber">Phone number</label>
          <div className="auth-input"><Phone size={17} /><input id="mobileNumber" name="mobileNumber" type="tel" autoComplete="current-password" required /></div>
          <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : null} Sign in</button>
        </form>
      )}
      {mode === "staff" ? (
        <>
          <div className="auth-divider"><span>or</span></div>
          <button className="passkey-button" disabled={pending} onClick={signInWithPasskey} type="button"><Fingerprint size={19} /> Sign in with a passkey</button>
        </>
      ) : null}
      <p className="auth-footnote">Accounts are created by a SovLend administrator.</p>
    </div>
  );
}
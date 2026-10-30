"use client";

import { Fingerprint, IdCard, LoaderCircle, Mail, Phone, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SovLendMark } from "@/components/sovlend-mark";
import { PasswordInput } from "@/components/ui/password-input";

export function SignInForm({ audience = "staff" }: { audience?: "staff" | "client" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

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
      toast.error(result.error.message?.trim() || "That email or password did not match. Try again, or ask an administrator to reset it.");
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
      <div className="auth-copy">
        <p className="eyebrow">{audience === "staff" ? "Branch desk" : "Your accounts"}</p>
        <h1>{audience === "staff" ? "Sign in to your workspace" : "Sign in as a client"}</h1>
        <p>{audience === "staff" ? "Use the email and password from your administrator." : "Use the account number and phone number on your passbook."}</p>
      </div>
      {audience === "staff" ? (
        <form action={signInWithEmail} className="auth-form">
          <label htmlFor="email">Email address</label>
          <div className="auth-input"><Mail size={17} /><input id="email" name="email" type="email" autoComplete="username webauthn" required /></div>
          <label htmlFor="password">Password</label>
          <PasswordInput id="password" name="password" minLength={6} autoComplete="current-password webauthn" required />
          <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : null} Sign in</button>
        </form>
      ) : (
        <form action={signInAsClient} className="auth-form">
          <label htmlFor="accountNumber">Account number</label>
          <div className="auth-input"><IdCard size={17} /><input id="accountNumber" name="accountNumber" type="text" autoComplete="username" required /></div>
          <label htmlFor="mobileNumber">Phone number</label>
          <div className="auth-input"><Phone size={17} /><input id="mobileNumber" name="mobileNumber" type="tel" autoComplete="tel" inputMode="tel" required /></div>
          <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : null} Sign in</button>
        </form>
      )}
      {audience === "staff" ? (
        <>
          <div className="auth-divider"><span>or</span></div>
          <button className="passkey-button" disabled={pending} onClick={signInWithPasskey} type="button"><Fingerprint size={19} /> Sign in with a passkey</button>
          <div className="auth-doors">
            <Link href="/sign-in/client">Client sign-in</Link>
            <Link href="/investor/sign-in"><TrendingUp size={17} /> Investor sign-in</Link>
          </div>
        </>
      ) : (
        <div className="auth-doors">
          <Link href="/sign-in">Staff sign-in</Link>
        </div>
      )}
    </div>
  );
}
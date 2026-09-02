"use client";

import { Fingerprint, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SovLendMark } from "@/components/sovlend-mark";

export function SignInForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

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
      <div className="auth-copy"><p className="eyebrow">Secure operations</p><h1>Sign in to your workspace</h1><p>Use your work email or a registered passkey.</p></div>
      <form action={signInWithEmail} className="auth-form">
        <label htmlFor="email">Email address</label>
        <div className="auth-input"><Mail size={17} /><input id="email" name="email" type="email" autoComplete="username webauthn" required /></div>
        <label htmlFor="password">Password</label>
        <div className="auth-input"><LockKeyhole size={17} /><input id="password" name="password" type="password" minLength={6} autoComplete="current-password webauthn" required /></div>
        <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : null} Sign in</button>
      </form>
      <div className="auth-divider"><span>or</span></div>
      <button className="passkey-button" disabled={pending} onClick={signInWithPasskey} type="button"><Fingerprint size={19} /> Sign in with a passkey</button>
      <p className="auth-footnote">Accounts are created by a SovLend administrator.</p>
    </div>
  );
}
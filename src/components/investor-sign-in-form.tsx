"use client";

import { ArrowLeft, Fingerprint, LoaderCircle, LockKeyhole, Mail, User, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SovLendMark } from "@/components/sovlend-mark";

export function InvestorSignInForm() {
  const router = useRouter();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [pending, setPending] = useState(false);
  const [needsPasskeyDetails, setNeedsPasskeyDetails] = useState(false);

  function goToInvestorDashboard() {
    router.replace("/investor");
    router.refresh();
  }

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
    goToInvestorDashboard();
  }

  async function continueWithPasskey() {
    setPending(true);
    const result = await authClient.signIn.passkey({ autoFill: false });
    setPending(false);

    if (!result.error) {
      toast.success("Passkey verified");
      goToInvestorDashboard();
      return;
    }

    // No passkey registered for this device/account yet -- offer to create one instead.
    setNeedsPasskeyDetails(true);
  }

  async function createAccountWithPasskey(formData: FormData) {
    setPending(true);
    const name = String(formData.get("name")).trim();
    const email = String(formData.get("email")).trim().toLowerCase();

    const result = await authClient.passkey.addPasskey({
      name: "Investor passkey",
      context: JSON.stringify({ intent: "investor-signup", name, email }),
      createSession: true,
    });
    setPending(false);

    if (result.error) {
      toast.error(result.error.message ?? "Could not create your passkey account");
      return;
    }

    toast.success("Account created with your passkey");
    goToInvestorDashboard();
  }

  async function signUp(formData: FormData) {
    setPending(true);
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));
    const name = String(formData.get("name"));

    const response = await fetch("/api/investor/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      setPending(false);
      toast.error(result?.error ?? "Account could not be created");
      return;
    }

    const signInResult = await authClient.signIn.email({ email, password, callbackURL: "/investor" });
    setPending(false);

    if (signInResult.error) {
      toast.success("Account created -- sign in below to continue");
      setTab("signin");
      return;
    }

    toast.success("Account created -- request access to a business once you're in");
    goToInvestorDashboard();
  }

  return (
    <main className="auth-page">
      <div className="auth-aside">
        <p className="eyebrow">Invest with visibility</p>
        <strong>One login for every business you back. Track each contribution from invoice to settlement.</strong>
        <small>Create your account instantly -- business details unlock once an admin approves your access request.</small>
      </div>
      <div className="auth-card">
        <div className="auth-brand"><SovLendMark /><span>SovLend</span></div>
        {needsPasskeyDetails ? (
          <>
            <div className="auth-copy">
              <p className="eyebrow">Investor portal</p>
              <h1>Create your investor account</h1>
              <p>No passkey found for this device. Add your name and email to create a new account -- your passkey becomes the login, no password needed.</p>
            </div>
            <form action={createAccountWithPasskey} className="auth-form">
              <label htmlFor="passkey-signup-name">Your name</label>
              <div className="auth-input"><User size={17} /><input id="passkey-signup-name" name="name" autoComplete="name" required /></div>
              <label htmlFor="passkey-signup-email">Email address</label>
              <div className="auth-input"><Mail size={17} /><input id="passkey-signup-email" name="email" type="email" autoComplete="username" required /></div>
              <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : <Fingerprint size={17} />} Create account with passkey</button>
            </form>
            <button className="text-button" disabled={pending} onClick={() => setNeedsPasskeyDetails(false)} type="button"><ArrowLeft size={14} /> Back</button>
          </>
        ) : (
          <>
            <div className="auth-copy">
              <p className="eyebrow">Investor portal</p>
              <h1>Sign in or create your investor account</h1>
              <p>One passkey covers both -- it signs you in if you have an account, or creates one instantly if you don&apos;t.</p>
            </div>
            <button className="passkey-button" disabled={pending} onClick={continueWithPasskey} type="button"><Fingerprint size={19} /> Continue with a passkey</button>
            <p className="field-hint">No password required.</p>
            <div className="auth-divider"><span>or use email and password</span></div>
            <div className="auth-tabs" role="tablist">
              <button className={tab === "signin" ? "auth-tab active" : "auth-tab"} onClick={() => setTab("signin")} role="tab" type="button">Sign in</button>
              <button className={tab === "signup" ? "auth-tab active" : "auth-tab"} onClick={() => setTab("signup")} role="tab" type="button">Sign up</button>
            </div>
            {tab === "signin" ? (
              <form action={signIn} className="auth-form">
                <label htmlFor="investor-email">Email address</label>
                <div className="auth-input"><Mail size={17} /><input id="investor-email" name="email" type="email" autoComplete="username webauthn" required /></div>
                <label htmlFor="investor-password">Password</label>
                <div className="auth-input"><LockKeyhole size={17} /><input id="investor-password" name="password" type="password" minLength={6} autoComplete="current-password webauthn" required /></div>
                <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : null} Sign in</button>
              </form>
            ) : (
              <form action={signUp} className="auth-form">
                <label htmlFor="investor-signup-name">Your name</label>
                <div className="auth-input"><User size={17} /><input id="investor-signup-name" name="name" autoComplete="name" required /></div>
                <label htmlFor="investor-signup-email">Email address</label>
                <div className="auth-input"><Mail size={17} /><input id="investor-signup-email" name="email" type="email" autoComplete="username" required /></div>
                <label htmlFor="investor-signup-password">Password</label>
                <div className="auth-input"><LockKeyhole size={17} /><input id="investor-signup-password" name="password" type="password" minLength={6} autoComplete="new-password" required /></div>
                <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : <UserPlus size={17} />} Create account</button>
              </form>
            )}
          </>
        )}
        <p className="auth-footnote">Not an investor? <Link href="/sign-in">Sign in to your workspace</Link>.</p>
      </div>
    </main>
  );
}

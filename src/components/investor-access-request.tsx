"use client";

import { LoaderCircle, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

export function InvestorAccessRequest({ organizations }: { organizations: Array<{ id: string; name: string }> }) {
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const response = await fetch("/api/investor/access-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(formData)) });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(result.error ?? "Request could not be sent");
      return;
    }
    setSubmitted(true);
    toast.success("Request received -- create your account to continue");
  }

  return (
    <main className="auth-page">
      <div className="auth-aside">
        <p className="eyebrow">Invest with visibility</p>
        <strong>Choose a registered business. Track every contribution.</strong>
        <small>Jump Start Africa is available as soon as you create an account. Other businesses are reviewed first.</small>
      </div>
      <div className="auth-card">
        <div className="auth-copy">
          <p className="eyebrow">Investor access</p>
          <h1>{submitted ? "Create your account to continue" : "Request an account"}</h1>
          <p>
            {submitted
              ? "Your request is with the team. Open the investor portal to sign in or create your account -- Jump Start Africa unlocks immediately after sign-up."
              : "Select the business you want to invest in, then create your investor account."}
          </p>
        </div>
        {submitted ? (
          <Link className="invest-button" href="/investor/sign-in">Go to investor sign in</Link>
        ) : (
          <form action={submit} className="stack-form compact-form">
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
        <p className="auth-footnote">Already have an account? <Link href="/investor/sign-in">Sign in to the investor portal</Link>.</p>
      </div>
    </main>
  );
}

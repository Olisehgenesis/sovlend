"use client";

import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SovLendMark } from "@/components/sovlend-mark";

export function ChangePasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    const currentPassword = String(formData.get("currentPassword"));
    const newPassword = String(formData.get("newPassword"));
    const confirmPassword = String(formData.get("confirmPassword"));

    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }

    setPending(true);
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    if (result.error) {
      setPending(false);
      toast.error(result.error.message ?? "Could not change password");
      return;
    }

    const cleared = await fetch("/api/account/clear-must-change-password", { method: "POST" });
    setPending(false);
    if (!cleared.ok) {
      toast.error("Password changed, but confirming with the server failed. Please sign in again.");
      return;
    }

    toast.success("Password updated");
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="auth-card">
      <div className="auth-brand"><SovLendMark /><span>SovLend</span></div>
      <div className="auth-copy">
        <p className="eyebrow">Secure your account</p>
        <h1>Choose a new password</h1>
        <p>Enter the temporary password you signed in with, then set a password only you know.</p>
      </div>
      <form action={submit} className="auth-form">
        <label htmlFor="currentPassword">Temporary password</label>
        <div className="auth-input"><LockKeyhole size={17} /><input autoComplete="current-password" id="currentPassword" minLength={6} name="currentPassword" required type="password" /></div>
        <label htmlFor="newPassword">New password</label>
        <div className="auth-input"><LockKeyhole size={17} /><input autoComplete="new-password" id="newPassword" minLength={6} name="newPassword" required type="password" /></div>
        <label htmlFor="confirmPassword">Confirm new password</label>
        <div className="auth-input"><LockKeyhole size={17} /><input autoComplete="new-password" id="confirmPassword" minLength={6} name="confirmPassword" required type="password" /></div>
        <button className="primary auth-submit" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={17} /> : null} Set new password</button>
      </form>
    </div>
  );
}

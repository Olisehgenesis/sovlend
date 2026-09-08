import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/change-password-form";
import { auth } from "@/lib/auth";

export default async function ChangePasswordPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <main className="auth-page">
      <div className="auth-aside">
        <p className="eyebrow">Sovereign lending infrastructure</p>
        <strong>Set a password only you know before you continue.</strong>
        <small>You&apos;re signing in with a shared temporary password. Choose a new one to secure your account.</small>
      </div>
      <ChangePasswordForm />
    </main>
  );
}

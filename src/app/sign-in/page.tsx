import { SignInForm } from "@/components/sign-in-form";

export default function SignInPage() {
  return <main className="auth-page"><div className="auth-aside"><p className="eyebrow">Sovereign lending infrastructure</p><strong>One secure identity for lending, treasury and investor operations.</strong><small>Passwords are hashed in PostgreSQL. Passkey private keys remain on the user&apos;s device.</small></div><SignInForm /></main>;
}
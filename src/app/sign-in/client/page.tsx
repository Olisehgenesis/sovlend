import { SignInForm } from "@/components/sign-in-form";

export default function ClientSignInPage() {
  return (
    <main className="auth-page">
      <div className="auth-aside">
        <p className="eyebrow">Your accounts</p>
        <strong>See your savings, your loans, and what is due.</strong>
      </div>
      <SignInForm audience="client" />
    </main>
  );
}

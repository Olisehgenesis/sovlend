import { SignInForm } from "@/components/sign-in-form";

export default function SignInPage() {
  return <main className="auth-page"><div className="auth-aside"><p className="eyebrow">Branch desk</p><strong>Record payments, open loans, and close the books.</strong></div><SignInForm /></main>;
}
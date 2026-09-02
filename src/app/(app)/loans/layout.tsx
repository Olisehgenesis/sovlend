import { LoanWorkflowStrip } from "@/components/loan-workflow-strip";

export default function LoansLayout({ children }: { children: React.ReactNode }) {
  return <><LoanWorkflowStrip />{children}</>;
}
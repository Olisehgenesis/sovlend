import { OperationsNav } from "@/components/operations-nav";
import { LoanWorkflowStrip } from "@/components/loan-workflow-strip";

export default function LoansLayout({ children }: { children: React.ReactNode }) {
  return <div className="workspace-screen"><OperationsNav active="loans" /><LoanWorkflowStrip />{children}</div>;
}
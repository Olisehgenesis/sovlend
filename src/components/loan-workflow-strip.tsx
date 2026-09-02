import { CheckCircle2, CircleDollarSign, FileCheck2, Landmark, ReceiptText } from "lucide-react";

const stages = [
  { label: "Application", detail: "Borrower and product", icon: FileCheck2 },
  { label: "Approval", detail: "Independent checker", icon: CheckCircle2 },
  { label: "Disbursement", detail: "Mapped settlement", icon: Landmark },
  { label: "Repayment", detail: "Allocated and posted", icon: ReceiptText },
  { label: "Closure", detail: "Balance reaches zero", icon: CircleDollarSign },
];

export function LoanWorkflowStrip() {
  return <section className="workflow-strip" aria-label="Loan lifecycle">{stages.map((stage, index) => { const Icon = stage.icon; return <div key={stage.label}><span className="workflow-index">{index + 1}</span><Icon size={16} /><span><strong>{stage.label}</strong><small>{stage.detail}</small></span></div>; })}</section>;
}
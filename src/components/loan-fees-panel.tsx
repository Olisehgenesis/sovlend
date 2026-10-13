"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BrandActionButton } from "@/components/ui/brand-action-button";
import { CRB_TOTAL_MINOR, CRB_PAYABLE_MINOR, CRB_INCOME_MINOR, LIF_HOLD_BPS, percentOfMinor } from "@/modules/lending/domain/disbursement-payout";
import { processingFeePercentSchema } from "@/modules/lending/domain/processing-fee";
import { formatMinor } from "@/modules/money/domain/format-minor";

export function LoanFeesPanel({ loanId, principalMinor, rateBps, updatedAt, canEdit, isDisbursed, lifExempt }: {
  loanId: string; principalMinor: string; rateBps: number; updatedAt: string; canEdit: boolean; isDisbursed: boolean; lifExempt: boolean;
}) {
  const router = useRouter();
  const [percent, setPercent] = useState(String(rateBps / 100));
  const [pending, setPending] = useState(false);
  const parsed = processingFeePercentSchema.safeParse(percent === "" ? NaN : percent);
  const principal = BigInt(principalMinor);
  const money = (value: bigint) => formatMinor(value, "UGX");
  async function save() {
    if (!parsed.success) { toast.error("Enter a percentage from 0 to 100 with at most two decimal places"); return; }
    setPending(true);
    try {
      const response = await fetch(`/api/loans/${loanId}/fees`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processingFeeBps: Math.round(parsed.data * 100), expectedUpdatedAt: updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) { toast.error(result.error ?? "Could not save loan fees"); return; }
      toast.success("Loan fees saved. Overview and disbursement preview updated.");
      router.refresh();
    } catch { toast.error("Could not save fees. Refresh before retrying."); }
    finally { setPending(false); }
  }
  return <section className="panel">
    <div className="panel-heading"><div><h2>Disbursement fees</h2><p>Processing is deducted from proceeds, not added to repayment dues. Saving here does not disburse the loan.</p></div></div>
    <form action={save} className="entity-form compact-mapping">
      <fieldset disabled={pending}>
        <legend>Loan processing fee</legend>
        <label>Processing fee % of principal<input type="number" min={0} max={100} step="0.01" required disabled={!canEdit} value={percent} onChange={(e) => setPercent(e.target.value)} /></label>
        <p>Saved rate: {rateBps / 100}% · saved fee: <strong>{money(percentOfMinor(principal, rateBps))}</strong></p>
        {parsed.success ? <p>Fee at entered rate: <strong>{money(percentOfMinor(principal, Math.round(parsed.data * 100)))}</strong></p> : <p role="alert">Enter a valid percentage.</p>}
      </fieldset>
      {canEdit ? <div className="form-actions"><BrandActionButton type="submit" disabled={pending || !parsed.success}>{pending ? "Saving..." : "Save fees"}</BrandActionButton></div> : <p>{isDisbursed ? "Fees are locked after disbursement to preserve posted records." : "Editing requires disbursement permission for this approved loan."}</p>}
    </form>
    <div className="table-scroll"><table><thead><tr><th>Other deduction</th><th>Amount</th><th>Policy</th></tr></thead><tbody>
      <tr><td>CRB</td><td>{money(CRB_TOTAL_MINOR)}</td><td>Compulsory, fixed: {money(CRB_PAYABLE_MINOR)} payable to UMRA + {money(CRB_INCOME_MINOR)} income.</td></tr>
      <tr><td>Loan insurance fund</td><td>{lifExempt ? "Exempt" : `${LIF_HOLD_BPS / 100}%`}</td><td>{lifExempt ? "No LIF deduction or release for this loan. Existing LIF savings remain unchanged." : "Required LIF balance; existing LIF and other active loans are considered in the disbursement preview."}</td></tr>
    </tbody></table></div>
    <p>Additional charges are managed separately in the Charges tab.</p>
  </section>;
}

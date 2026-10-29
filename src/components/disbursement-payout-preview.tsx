"use client";

import { buildDisbursementPayoutChoice, disbursementCashToMemberMinor, extraDisbursementChargesMinor, selectDisbursementExtraCharges } from "@/modules/lending/domain/disbursement-payout";
import { formatMinor } from "@/modules/money/domain/format-minor";

export type DisbursementPayoutCharge = Readonly<{ name: string; amountMinor: string }>;

export type DisbursementPayoutLoanOption = Readonly<{
  id: string;
  accountNumber: string;
  principalMinor: string;
  outstandingMinor: string;
  lifExempt?: boolean;
}>;

export type DisbursementPayoutContext = Readonly<{
  principalMinor: string;
  currency: string;
  existingLifMinor: string;
  extraCharges: readonly DisbursementPayoutCharge[];
  otherLoans: readonly DisbursementPayoutLoanOption[];
  lifAccountNumber?: string | null;
  securityAccountNumber?: string | null;
  contributionAccountNumber?: string | null;
  collectCrb?: boolean;
  collectProcessingFee?: boolean;
  collectLif?: boolean;
  collectExtraCharges?: boolean;
  processingFeeBps?: number;
  lifExempt?: boolean;
}>;

function asMinor(value: string) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function DisbursementPayoutPreview({
  context,
  liquidateLoanId,
}: {
  context: DisbursementPayoutContext;
  liquidateLoanId?: string | null;
}) {
  let error = "";
  let choice: ReturnType<typeof buildDisbursementPayoutChoice> | null = null;
  const extraCharges = selectDisbursementExtraCharges(context.extraCharges, {
    collectProcessingFee: context.collectProcessingFee,
    collectExtraCharges: context.collectExtraCharges,
  });
  try {
    choice = buildDisbursementPayoutChoice({
      principalMinor: asMinor(context.principalMinor),
      existingLifMinor: asMinor(context.existingLifMinor),
      extraChargesMinor: extraDisbursementChargesMinor(
        extraCharges.map((charge) => ({ name: charge.name, amountMinor: asMinor(charge.amountMinor) })),
      ),
      otherLoans: context.otherLoans.map((loan) => ({
        id: loan.id,
        principalMinor: asMinor(loan.principalMinor),
        outstandingMinor: asMinor(loan.outstandingMinor),
        lifExempt: loan.lifExempt,
      })),
      liquidateLoanId,
      collectCrb: context.collectCrb,
      processingFeeBps: context.collectProcessingFee === false ? 0 : context.processingFeeBps,
      lifExempt: context.lifExempt || context.collectLif === false,
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not build this disbursement preview.";
  }

  if (!choice) {
    return <p className="muted-text">{error}</p>;
  }

  const money = (amount: bigint) => formatMinor(amount, context.currency);
  const payout = choice.payout;
  const selected = context.otherLoans.find((loan) => loan.id === liquidateLoanId);
  const cashToMember = disbursementCashToMemberMinor(payout, choice.payoffMinor);

  return (
    <div className="disbursement-payout">
      <dl className="loan-preview-metrics disbursement-payout-metrics">
        <div>
          <dt>Principal</dt>
          <dd>{money(payout.principalMinor)}</dd>
        </div>
        <div>
          <dt>{context.lifExempt ? "LIF exempt" : "LIF 15%"}</dt>
          <dd>{money(context.lifExempt ? 0n : payout.lifRequiredMinor)}</dd>
        </div>
        <div>
          <dt>Processing {(context.processingFeeBps ?? 200) / 100}%</dt>
          <dd>{money(payout.processingFeeMinor)}</dd>
        </div>
        {payout.crbTotalMinor > 0n ? (
        <div>
          <dt>CRB</dt>
          <dd>{money(payout.crbTotalMinor)}</dd>
        </div>
        ) : null}
        <div>
          <dt>To withdraw</dt>
          <dd>{money(cashToMember)}</dd>
        </div>
      </dl>
      <div className="table-scroll">
        <table className="disbursement-payout-table">
          <tbody>
            <tr>
              <th>Loan principal</th>
              <td className="numeric">{money(payout.principalMinor)}</td>
            </tr>
            <tr>
              <th>
                {context.lifExempt ? "Loan insurance fund — exempt" : "Loan insurance fund (15%)"}
                <span className="field-hint">
                  {context.lifExempt ? "No LIF deduction or release for this loan. Existing LIF savings remain unchanged." : `Required ${money(payout.lifRequiredMinor)} · already on LIF ${money(payout.existingLifMinor)}`}
                  {context.lifAccountNumber ? ` · ${context.lifAccountNumber}` : ""}
                </span>
              </th>
              <td className="numeric">
                {payout.lifHeldFromProceedsMinor > 0n
                  ? `−${money(payout.lifHeldFromProceedsMinor)}`
                  : payout.lifReleasedToSecurityMinor > 0n
                    ? `+${money(payout.lifReleasedToSecurityMinor)} released`
                    : money(0n)}
              </td>
            </tr>
            <tr>
              <th>
                Processing fee ({(context.processingFeeBps ?? 200) / 100}%)
                <span className="field-hint">Income on the income statement</span>
              </th>
              <td className="numeric">−{money(payout.processingFeeMinor)}</td>
            </tr>
            {payout.crbTotalMinor > 0n ? (
            <tr>
              <th>
                CRB 15,000 (compulsory)
                <span className="field-hint">
                  {money(payout.crbPayableMinor)} payable to UMRA (CRB fee, GL 202021) · {money(payout.crbIncomeMinor)} our income (GL 202020)
                </span>
              </th>
              <td className="numeric">−{money(payout.crbTotalMinor)}</td>
            </tr>
            ) : null}
            {extraCharges.map((charge) => (
              <tr key={charge.name}>
                <th>{charge.name}</th>
                <td className="numeric">−{money(asMinor(charge.amountMinor))}</td>
              </tr>
            ))}
            {selected ? (
              <tr>
                <th>
                  Liquidate {selected.accountNumber}
                  <span className="field-hint">
                    {context.lifExempt ? "This loan is LIF-exempt. Existing LIF savings remain unchanged." : choice.fullyClosesPrevious
                      ? "Previous loan is paid off from these proceeds. LIF is reset to 15% of the new loan only."
                      : "Proceeds are not enough to close the previous loan. LIF stays at 15% of both active loans."}
                  </span>
                </th>
                <td className="numeric">−{money(choice.payoffMinor)}</td>
              </tr>
            ) : null}
            {payout.lifReleasedToSecurityMinor > 0n ? (
              <tr>
                <th>
                  Loan security payable
                  <span className="field-hint">
                    Surplus LIF above 15%
                    {context.securityAccountNumber ? ` · ${context.securityAccountNumber}` : ""}
                  </span>
                </th>
                <td className="numeric">+{money(payout.lifReleasedToSecurityMinor)}</td>
              </tr>
            ) : null}
            <tr className="disbursement-payout-total">
              <th>
                Member contribution (withdraw)
                <span className="field-hint">
                  {context.contributionAccountNumber
                    ? `Credited to ${context.contributionAccountNumber}, then withdrawn as cash`
                    : "This is the cash the borrower takes"}
                </span>
              </th>
              <td className="numeric">{money(cashToMember)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

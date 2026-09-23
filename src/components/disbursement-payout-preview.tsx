"use client";

import { buildDisbursementPayoutChoice, disbursementCashToMemberMinor, extraDisbursementChargesMinor, isStatutoryDisbursementCharge } from "@/modules/lending/domain/disbursement-payout";
import { formatMinor } from "@/modules/money/domain/format-minor";

export type DisbursementPayoutCharge = Readonly<{ name: string; amountMinor: string }>;

export type DisbursementPayoutLoanOption = Readonly<{
  id: string;
  accountNumber: string;
  principalMinor: string;
  outstandingMinor: string;
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
  const extraCharges = context.extraCharges.filter((charge) => !isStatutoryDisbursementCharge(charge.name));
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
      })),
      liquidateLoanId,
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
          <dt>LIF 15%</dt>
          <dd>{money(payout.lifRequiredMinor)}</dd>
        </div>
        <div>
          <dt>Processing 2%</dt>
          <dd>{money(payout.processingFeeMinor)}</dd>
        </div>
        <div>
          <dt>CRB</dt>
          <dd>{money(payout.crbTotalMinor)}</dd>
        </div>
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
                Loan insurance fund (15%)
                <span className="field-hint">
                  Required {money(payout.lifRequiredMinor)} · already on LIF {money(payout.existingLifMinor)}
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
                Processing fee (2%)
                <span className="field-hint">Income on the income statement</span>
              </th>
              <td className="numeric">−{money(payout.processingFeeMinor)}</td>
            </tr>
            <tr>
              <th>
                CRB 15,000
                <span className="field-hint">
                  {money(payout.crbPayableMinor)} payable to the association of loan lenders · {money(payout.crbIncomeMinor)} income
                </span>
              </th>
              <td className="numeric">−{money(payout.crbTotalMinor)}</td>
            </tr>
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
                    {choice.fullyClosesPrevious
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

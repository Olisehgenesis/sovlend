/** 15% of each active loan's principal must sit in LIF (Loan insurance fund). */
export const LIF_HOLD_BPS = 1_500;
/** 2% of the new principal is recognized as processing-fee income. */
export const PROCESSING_FEE_BPS = 200;
/** Flat CRB levy in minor units (15,000 UGX). */
export const CRB_TOTAL_MINOR = 1_500_000n;
/** 10,000 UGX payable to the association of loan lenders (GL "CRB fee"). */
export const CRB_PAYABLE_MINOR = 1_000_000n;
/** 5,000 UGX CRB income. */
export const CRB_INCOME_MINOR = 500_000n;

export const LIF_SAVINGS_SHORT_NAME = "LAS";
export const SECURITY_SAVINGS_SHORT_NAME = "cs";

export type DisbursementPayout = Readonly<{
  principalMinor: bigint;
  remainingActivePrincipalMinor: bigint;
  lifRequiredMinor: bigint;
  existingLifMinor: bigint;
  lifHeldFromProceedsMinor: bigint;
  lifReleasedToSecurityMinor: bigint;
  processingFeeMinor: bigint;
  crbTotalMinor: bigint;
  crbPayableMinor: bigint;
  crbIncomeMinor: bigint;
  extraChargesMinor: bigint;
  withdrawableMinor: bigint;
}>;

export type OpenLoanForPayout = Readonly<{
  id: string;
  principalMinor: bigint;
  outstandingMinor: bigint;
}>;

export function percentOfMinor(amountMinor: bigint, bps: number) {
  if (amountMinor <= 0n || bps <= 0) return 0n;
  return (amountMinor * BigInt(bps)) / 10_000n;
}

export function isStatutoryDisbursementCharge(name: string) {
  const normalized = name.trim().toLowerCase();
  return (
    normalized.includes("processing") ||
    normalized.includes("crb") ||
    normalized.includes("credit reference") ||
    normalized.includes("lif") ||
    normalized.includes("insurance")
  );
}

export function extraDisbursementChargesMinor(charges: readonly { name: string; amountMinor: bigint }[]) {
  return charges.reduce(
    (sum, charge) => (isStatutoryDisbursementCharge(charge.name) ? sum : sum + charge.amountMinor),
    0n,
  );
}

export function buildDisbursementPayout(input: {
  principalMinor: bigint;
  existingLifMinor: bigint;
  remainingActivePrincipalMinor: bigint;
  extraChargesMinor: bigint;
}): DisbursementPayout {
  if (input.principalMinor <= 0n) throw new Error("Principal must be positive");
  const remainingActivePrincipalMinor = input.remainingActivePrincipalMinor < 0n ? 0n : input.remainingActivePrincipalMinor;
  const existingLifMinor = input.existingLifMinor < 0n ? 0n : input.existingLifMinor;
  const extraChargesMinor = input.extraChargesMinor < 0n ? 0n : input.extraChargesMinor;
  const lifRequiredMinor = percentOfMinor(input.principalMinor + remainingActivePrincipalMinor, LIF_HOLD_BPS);
  const processingFeeMinor = percentOfMinor(input.principalMinor, PROCESSING_FEE_BPS);
  const lifHeldFromProceedsMinor = lifRequiredMinor > existingLifMinor ? lifRequiredMinor - existingLifMinor : 0n;
  const lifReleasedToSecurityMinor = existingLifMinor > lifRequiredMinor ? existingLifMinor - lifRequiredMinor : 0n;
  const withheldMinor = lifHeldFromProceedsMinor + processingFeeMinor + CRB_TOTAL_MINOR + extraChargesMinor;
  if (withheldMinor > input.principalMinor) {
    throw new Error("Disbursement deductions exceed the approved principal");
  }
  const withdrawableMinor = input.principalMinor - withheldMinor + lifReleasedToSecurityMinor;
  return {
    principalMinor: input.principalMinor,
    remainingActivePrincipalMinor,
    lifRequiredMinor,
    existingLifMinor,
    lifHeldFromProceedsMinor,
    lifReleasedToSecurityMinor,
    processingFeeMinor,
    crbTotalMinor: CRB_TOTAL_MINOR,
    crbPayableMinor: CRB_PAYABLE_MINOR,
    crbIncomeMinor: CRB_INCOME_MINOR,
    extraChargesMinor,
    withdrawableMinor,
  };
}

export function remainingActivePrincipalMinor(
  otherLoans: readonly OpenLoanForPayout[],
  liquidateLoanId: string | null | undefined,
) {
  return otherLoans.reduce((sum, loan) => {
    if (liquidateLoanId && loan.id === liquidateLoanId) return sum;
    return sum + loan.principalMinor;
  }, 0n);
}

export function buildDisbursementPayoutChoice(input: {
  principalMinor: bigint;
  existingLifMinor: bigint;
  extraChargesMinor: bigint;
  otherLoans: readonly OpenLoanForPayout[];
  liquidateLoanId?: string | null;
}) {
  const selected = input.otherLoans.find((loan) => loan.id === input.liquidateLoanId) ?? null;
  const closedPayout =
    selected == null
      ? null
      : buildDisbursementPayout({
          principalMinor: input.principalMinor,
          existingLifMinor: input.existingLifMinor,
          remainingActivePrincipalMinor: remainingActivePrincipalMinor(input.otherLoans, selected.id),
          extraChargesMinor: input.extraChargesMinor,
        });
  const canFullyClose = Boolean(selected && closedPayout && closedPayout.withdrawableMinor >= selected.outstandingMinor);
  const payout = canFullyClose && closedPayout
    ? closedPayout
    : buildDisbursementPayout({
        principalMinor: input.principalMinor,
        existingLifMinor: input.existingLifMinor,
        remainingActivePrincipalMinor: remainingActivePrincipalMinor(input.otherLoans, canFullyClose ? selected?.id : null),
        extraChargesMinor: input.extraChargesMinor,
      });
  const payoffMinor =
    selected == null || payout.withdrawableMinor <= 0n
      ? 0n
      : selected.outstandingMinor < payout.withdrawableMinor
        ? selected.outstandingMinor
        : payout.withdrawableMinor;
  return {
    payout,
    liquidateLoanId: selected?.id ?? null,
    payoffMinor,
    remainingWithdrawMinor: payout.withdrawableMinor - payoffMinor,
    fullyClosesPrevious: canFullyClose,
  };
}

export type DisbursementOverviewLine = Readonly<{
  key: "lif" | "processing" | "crb";
  label: string;
  original: bigint;
  paid: bigint;
  waived: bigint;
  overdue: bigint;
  outstanding: bigint;
}>;

export function disbursementOverviewRows(input: { principalMinor: bigint; disbursed: boolean }): DisbursementOverviewLine[] {
  const lif = percentOfMinor(input.principalMinor, LIF_HOLD_BPS);
  const processing = percentOfMinor(input.principalMinor, PROCESSING_FEE_BPS);
  const paid = (amount: bigint) => (input.disbursed ? amount : 0n);
  const rows: DisbursementOverviewLine[] = [
    {
      key: "lif",
      label: "Loan insurance fund",
      original: lif,
      paid: paid(lif),
      waived: 0n,
      overdue: 0n,
      outstanding: 0n,
    },
    {
      key: "processing",
      label: "Processing fee",
      original: processing,
      paid: paid(processing),
      waived: 0n,
      overdue: 0n,
      outstanding: 0n,
    },
    {
      key: "crb",
      label: "CRB",
      original: CRB_TOTAL_MINOR,
      paid: paid(CRB_TOTAL_MINOR),
      waived: 0n,
      overdue: 0n,
      outstanding: 0n,
    },
  ];
  return rows.filter((row) => row.original > 0n);
}

import { processingFeeBpsSchema } from "./processing-fee";

/** 15% of each active loan's principal must sit in LIF (Loan insurance fund). */
export const LIF_HOLD_BPS = 1_500;
/** 2% of the new principal is recognized as processing-fee income. */
export const PROCESSING_FEE_BPS = 200;
/** Flat CRB levy in minor units (15,000 UGX). */
export const CRB_TOTAL_MINOR = 1_500_000n;
/** 10,000 UGX payable to UMRA (liability GL "CRB fee", code 202021). */
export const CRB_PAYABLE_MINOR = 1_000_000n;
/** 5,000 UGX CRB income. */
export const CRB_INCOME_MINOR = 500_000n;

export const LIF_SAVINGS_SHORT_NAME = "LAS";
export const SECURITY_SAVINGS_SHORT_NAME = "cs";
export const MEMBER_CONTRIBUTION_SAVINGS_SHORT_NAME = "MSA";

export const PROCESSING_FEE_CHARGE_NAME = "Processing fee";
export const CRB_INCOME_CHARGE_NAME = "CRB income";
export const CRB_FEE_CHARGE_NAME = "CRB fee";

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
  lifExempt?: boolean;
}>;

export function isLoanLifExempt(snapshot: unknown): boolean {
  return Boolean(snapshot && typeof snapshot === "object" && "lifExempt" in snapshot && snapshot.lifExempt === true);
}

export function percentOfMinor(amountMinor: bigint, bps: number) {
  if (amountMinor <= 0n || bps <= 0) return 0n;
  return (amountMinor * BigInt(bps)) / 10_000n;
}

export function isStatutoryDisbursementCharge(name: string) {
  const normalized = name.trim().toLowerCase();
  // Only the auto-created disbursement rows. Catalog "Loan processing fee" (flat 10,000) must
  // still come off proceeds; matching any name that merely contains "processing" used to skip it.
  return (
    normalized === PROCESSING_FEE_CHARGE_NAME.toLowerCase() ||
    normalized === CRB_INCOME_CHARGE_NAME.toLowerCase() ||
    normalized === CRB_FEE_CHARGE_NAME.toLowerCase() ||
    normalized === "crb" ||
    normalized.includes("credit reference") ||
    normalized.includes("lif") ||
    normalized.includes("insurance")
  );
}

export function isProcessingCatalogCharge(name: string) {
  return name.trim().toLowerCase().includes("processing");
}

export function selectDisbursementExtraCharges<T extends { name: string }>(
  charges: readonly T[],
  flags: { collectProcessingFee?: boolean; collectExtraCharges?: boolean } = {},
): T[] {
  const collectProcessingFee = flags.collectProcessingFee !== false;
  const collectExtraCharges = flags.collectExtraCharges !== false;
  return charges.filter((charge) => {
    if (isStatutoryDisbursementCharge(charge.name)) return false;
    if (isProcessingCatalogCharge(charge.name)) return collectProcessingFee;
    return collectExtraCharges;
  });
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
  collectCrb?: boolean;
  processingFeeBps?: number;
  lifExempt?: boolean;
}): DisbursementPayout {
  if (input.principalMinor <= 0n) throw new Error("Principal must be positive");
  const remainingActivePrincipalMinor = input.remainingActivePrincipalMinor < 0n ? 0n : input.remainingActivePrincipalMinor;
  const existingLifMinor = input.existingLifMinor < 0n ? 0n : input.existingLifMinor;
  const extraChargesMinor = input.extraChargesMinor < 0n ? 0n : input.extraChargesMinor;
  const collectCrb = input.collectCrb !== false;
  const crbTotalMinor = collectCrb ? CRB_TOTAL_MINOR : 0n;
  const crbPayableMinor = collectCrb ? CRB_PAYABLE_MINOR : 0n;
  const crbIncomeMinor = collectCrb ? CRB_INCOME_MINOR : 0n;
  const lifRequiredMinor = percentOfMinor((input.lifExempt ? 0n : input.principalMinor) + remainingActivePrincipalMinor, LIF_HOLD_BPS);
  const processingFeeMinor = percentOfMinor(input.principalMinor, processingFeeBpsSchema.parse(input.processingFeeBps ?? PROCESSING_FEE_BPS));
  // A loan-specific exemption must not move existing savings or other loans' LIF.
  const lifHeldFromProceedsMinor = !input.lifExempt && lifRequiredMinor > existingLifMinor ? lifRequiredMinor - existingLifMinor : 0n;
  const lifReleasedToSecurityMinor = !input.lifExempt && existingLifMinor > lifRequiredMinor ? existingLifMinor - lifRequiredMinor : 0n;
  const withheldMinor = lifHeldFromProceedsMinor + processingFeeMinor + crbTotalMinor + extraChargesMinor;
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
    crbTotalMinor,
    crbPayableMinor,
    crbIncomeMinor,
    extraChargesMinor,
    withdrawableMinor,
  };
}

export function remainingActivePrincipalMinor(
  otherLoans: readonly OpenLoanForPayout[],
  liquidateLoanId: string | null | undefined,
) {
  return otherLoans.reduce((sum, loan) => {
    if (loan.lifExempt || (liquidateLoanId && loan.id === liquidateLoanId)) return sum;
    return sum + loan.principalMinor;
  }, 0n);
}

export function buildDisbursementPayoutChoice(input: {
  principalMinor: bigint;
  existingLifMinor: bigint;
  extraChargesMinor: bigint;
  otherLoans: readonly OpenLoanForPayout[];
  liquidateLoanId?: string | null;
  collectCrb?: boolean;
  processingFeeBps?: number;
  lifExempt?: boolean;
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
          collectCrb: input.collectCrb,
          processingFeeBps: input.processingFeeBps,
          lifExempt: input.lifExempt,
        });
  const canFullyClose = Boolean(selected && closedPayout && closedPayout.withdrawableMinor >= selected.outstandingMinor);
  const payout = canFullyClose && closedPayout
    ? closedPayout
    : buildDisbursementPayout({
        principalMinor: input.principalMinor,
        existingLifMinor: input.existingLifMinor,
        remainingActivePrincipalMinor: remainingActivePrincipalMinor(input.otherLoans, canFullyClose ? selected?.id : null),
        extraChargesMinor: input.extraChargesMinor,
        collectCrb: input.collectCrb,
        processingFeeBps: input.processingFeeBps,
        lifExempt: input.lifExempt,
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

/** Cash credited to member contributions after LIF surplus is parked on loan security payable. */
export function disbursementCashToMemberMinor(payout: DisbursementPayout, payoffMinor = 0n) {
  const cash = payout.withdrawableMinor - payout.lifReleasedToSecurityMinor - payoffMinor;
  return cash > 0n ? cash : 0n;
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

export function disbursementOverviewRows(input: { principalMinor: bigint; disbursed: boolean; collectCrb?: boolean; processingFeeBps?: number; lifExempt?: boolean }): DisbursementOverviewLine[] {
  const lif = input.lifExempt ? 0n : percentOfMinor(input.principalMinor, LIF_HOLD_BPS);
  const processing = percentOfMinor(input.principalMinor, processingFeeBpsSchema.parse(input.processingFeeBps ?? PROCESSING_FEE_BPS));
  const collectCrb = input.collectCrb !== false;
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
      original: collectCrb ? CRB_TOTAL_MINOR : 0n,
      paid: paid(collectCrb ? CRB_TOTAL_MINOR : 0n),
      waived: 0n,
      overdue: 0n,
      outstanding: 0n,
    },
  ];
  return rows.filter((row) => row.original > 0n);
}

export function statutoryDisbursementChargeSpecs(
  payout: Pick<DisbursementPayout, "processingFeeMinor" | "crbIncomeMinor" | "crbPayableMinor">,
) {
  return [
    { name: PROCESSING_FEE_CHARGE_NAME, amountMinor: payout.processingFeeMinor },
    { name: CRB_INCOME_CHARGE_NAME, amountMinor: payout.crbIncomeMinor },
    { name: CRB_FEE_CHARGE_NAME, amountMinor: payout.crbPayableMinor },
  ].filter((spec) => spec.amountMinor > 0n);
}

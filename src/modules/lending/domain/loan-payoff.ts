export type PayoffInstallment = Readonly<{
  id: string;
  dueOn: Date;
  installmentNumber: number;
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  feesDueMinor: bigint;
  penaltiesDueMinor: bigint;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  feesPaidMinor: bigint;
  penaltiesPaidMinor: bigint;
}>;

export type PayoffInstallmentSettlement = Readonly<{
  installmentId: string;
  principalMinor: bigint;
  interestCollectedMinor: bigint;
  interestWaivedMinor: bigint;
  feesMinor: bigint;
  penaltiesCollectedMinor: bigint;
  penaltiesWaivedMinor: bigint;
}>;

export type PayoffQuote = Readonly<{
  asOfDate: Date;
  waivePenalties: boolean;
  principalOutstandingMinor: bigint;
  interestAccruedMinor: bigint;
  interestWaivedMinor: bigint;
  feesOutstandingMinor: bigint;
  penaltiesCollectedMinor: bigint;
  penaltiesWaivedMinor: bigint;
  totalPayoffMinor: bigint;
  settlements: readonly PayoffInstallmentSettlement[];
}>;

/**
 * Computes the early full-settlement (prepay/foreclosure) payoff amount for a loan as of a
 * given business date.
 *
 * Accounting rationale: interest and penalty income are recognised on a cash basis only when
 * collected (see post-repayment.ts) — nothing is booked as receivable/income for scheduled
 * amounts ahead of their due date. So waiving interest/penalties that are not yet due requires
 * no reversing ledger entry; it simply means that amount is never collected or recognised.
 * Principal, however, is booked as a receivable in full at disbursement, so the full remaining
 * principal (due or not yet due) must always be collected to close out that receivable.
 */
export function calculateLoanPayoff(
  installments: readonly PayoffInstallment[],
  options: { asOfDate: Date; waivePenalties?: boolean },
): PayoffQuote {
  const waivePenalties = options.waivePenalties ?? false;
  const settlements: PayoffInstallmentSettlement[] = [];
  let principalOutstandingMinor = 0n;
  let interestAccruedMinor = 0n;
  let interestWaivedMinor = 0n;
  let feesOutstandingMinor = 0n;
  let penaltiesCollectedMinor = 0n;
  let penaltiesWaivedMinor = 0n;

  const sorted = [...installments].sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime() || left.installmentNumber - right.installmentNumber);
  for (const installment of sorted) {
    const principalMinor = installment.principalDueMinor - installment.principalPaidMinor;
    const interestOutstanding = installment.interestDueMinor - installment.interestPaidMinor;
    const isDue = installment.dueOn <= options.asOfDate;
    const interestCollected = isDue ? interestOutstanding : 0n;
    const interestWaived = isDue ? 0n : interestOutstanding;
    const feesMinor = installment.feesDueMinor - installment.feesPaidMinor;
    const penaltiesOutstanding = installment.penaltiesDueMinor - installment.penaltiesPaidMinor;
    const penaltiesCollected = waivePenalties ? 0n : penaltiesOutstanding;
    const penaltiesWaived = waivePenalties ? penaltiesOutstanding : 0n;

    if (principalMinor <= 0n && interestOutstanding <= 0n && feesMinor <= 0n && penaltiesOutstanding <= 0n) continue;

    principalOutstandingMinor += max0(principalMinor);
    interestAccruedMinor += max0(interestCollected);
    interestWaivedMinor += max0(interestWaived);
    feesOutstandingMinor += max0(feesMinor);
    penaltiesCollectedMinor += max0(penaltiesCollected);
    penaltiesWaivedMinor += max0(penaltiesWaived);

    settlements.push({
      installmentId: installment.id,
      principalMinor: max0(principalMinor),
      interestCollectedMinor: max0(interestCollected),
      interestWaivedMinor: max0(interestWaived),
      feesMinor: max0(feesMinor),
      penaltiesCollectedMinor: max0(penaltiesCollected),
      penaltiesWaivedMinor: max0(penaltiesWaived),
    });
  }

  const totalPayoffMinor = principalOutstandingMinor + interestAccruedMinor + feesOutstandingMinor + penaltiesCollectedMinor;

  return {
    asOfDate: options.asOfDate,
    waivePenalties,
    principalOutstandingMinor,
    interestAccruedMinor,
    interestWaivedMinor,
    feesOutstandingMinor,
    penaltiesCollectedMinor,
    penaltiesWaivedMinor,
    totalPayoffMinor,
    settlements,
  };
}

function max0(value: bigint) {
  return value < 0n ? 0n : value;
}

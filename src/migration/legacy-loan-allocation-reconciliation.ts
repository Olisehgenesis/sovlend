const COMPONENT_KEYS = ["penaltiesMinor", "feesMinor", "monitoringFeeMinor", "interestMinor", "principalMinor"] as const;

type ComponentKey = (typeof COMPONENT_KEYS)[number];

export type LegacyAllocationInstallment = Readonly<{
  id: string;
  dueOn: Date;
  installmentNumber: number;
  principalPaidRemainingMinor: bigint;
  interestPaidRemainingMinor: bigint;
  feesPaidRemainingMinor: bigint;
  penaltiesPaidRemainingMinor: bigint;
  monitoringFeePaidRemainingMinor: bigint;
}>;

export type LegacyAllocationTransaction = Readonly<{
  id: string;
  businessDate: Date;
  sortKey?: number;
  principalMinor: bigint;
  interestMinor: bigint;
  feesMinor: bigint;
  penaltiesMinor: bigint;
  monitoringFeeMinor: bigint;
}>;

export type LegacyTransactionInstallmentAllocation = Readonly<{
  transactionId: string;
  installmentId: string;
  principalMinor: bigint;
  interestMinor: bigint;
  feesMinor: bigint;
  penaltiesMinor: bigint;
  monitoringFeeMinor: bigint;
}>;

export type LegacyLoanAllocationReconciliation = Readonly<
  | {
      ok: true;
      adjustedForRounding: boolean;
      adjustments: readonly string[];
      allocations: readonly LegacyTransactionInstallmentAllocation[];
    }
  | {
      ok: false;
      reason: string;
      adjustments: readonly string[];
    }
>;

export function reconcileLegacyLoanAllocations(
  installments: readonly LegacyAllocationInstallment[],
  transactions: readonly LegacyAllocationTransaction[],
  options: Readonly<{ roundingToleranceMinor?: bigint }> = {},
): LegacyLoanAllocationReconciliation {
  const roundingToleranceMinor = options.roundingToleranceMinor ?? 2n;
  const sortedInstallments = [...installments]
    .map((installment) => ({ ...installment }))
    .sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime() || left.installmentNumber - right.installmentNumber);
  const sortedTransactions = [...transactions]
    .map((transaction) => ({ ...transaction }))
    .sort((left, right) => left.businessDate.getTime() - right.businessDate.getTime() || (left.sortKey ?? Number.MAX_SAFE_INTEGER) - (right.sortKey ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
  const adjustments: string[] = [];

  for (const key of COMPONENT_KEYS) {
    const installmentTotal = sumInstallmentComponent(sortedInstallments, installmentField(key));
    const transactionTotal = sumTransactionComponent(sortedTransactions, key);
    const delta = installmentTotal - transactionTotal;
    if (absolute(delta) > roundingToleranceMinor) {
      return { ok: false, reason: `${key} totals differ by ${delta.toString()} minor units`, adjustments };
    }
    if (delta === 0n) continue;
    const label = key.replace("Minor", "");
    if (delta > 0n) {
      const target = sortedTransactions[sortedTransactions.length - 1];
      if (!target) return { ok: false, reason: `No transaction available for ${label} rounding adjustment`, adjustments };
      target[key] += delta;
      adjustments.push(`Adjusted ${label} by +${delta.toString()} on transaction ${target.id} to absorb rounding`);
      continue;
    }
    let remaining = -delta;
    for (const transaction of [...sortedTransactions].reverse()) {
      if (remaining === 0n) break;
      const take = transaction[key] < remaining ? transaction[key] : remaining;
      if (take <= 0n) continue;
      transaction[key] -= take;
      remaining -= take;
      adjustments.push(`Adjusted ${label} by -${take.toString()} on transaction ${transaction.id} to absorb rounding`);
    }
    if (remaining > 0n) {
      return { ok: false, reason: `Unable to absorb ${label} rounding delta of ${remaining.toString()} minor units`, adjustments };
    }
  }

  const allocations: LegacyTransactionInstallmentAllocation[] = [];
  for (const transaction of sortedTransactions) {
    const remaining = {
      principalMinor: transaction.principalMinor,
      interestMinor: transaction.interestMinor,
      feesMinor: transaction.feesMinor,
      penaltiesMinor: transaction.penaltiesMinor,
      monitoringFeeMinor: transaction.monitoringFeeMinor,
    };

    for (const installment of sortedInstallments) {
      const allocation: LegacyTransactionInstallmentAllocation = {
        transactionId: transaction.id,
        installmentId: installment.id,
        principalMinor: take(installment.principalPaidRemainingMinor, remaining.principalMinor),
        interestMinor: take(installment.interestPaidRemainingMinor, remaining.interestMinor),
        feesMinor: take(installment.feesPaidRemainingMinor, remaining.feesMinor),
        penaltiesMinor: take(installment.penaltiesPaidRemainingMinor, remaining.penaltiesMinor),
        monitoringFeeMinor: take(installment.monitoringFeePaidRemainingMinor, remaining.monitoringFeeMinor),
      };
      installment.principalPaidRemainingMinor -= allocation.principalMinor;
      installment.interestPaidRemainingMinor -= allocation.interestMinor;
      installment.feesPaidRemainingMinor -= allocation.feesMinor;
      installment.penaltiesPaidRemainingMinor -= allocation.penaltiesMinor;
      installment.monitoringFeePaidRemainingMinor -= allocation.monitoringFeeMinor;
      remaining.principalMinor -= allocation.principalMinor;
      remaining.interestMinor -= allocation.interestMinor;
      remaining.feesMinor -= allocation.feesMinor;
      remaining.penaltiesMinor -= allocation.penaltiesMinor;
      remaining.monitoringFeeMinor -= allocation.monitoringFeeMinor;
      if (componentTotal(allocation) > 0n) allocations.push(allocation);
      if (componentTotal(remaining) === 0n) break;
    }

    if (componentTotal(remaining) > 0n) {
      return { ok: false, reason: `Transaction ${transaction.id} could not be fully allocated (${componentTotal(remaining).toString()} minor units left)`, adjustments };
    }
  }

  const leftover = sortedInstallments.reduce(
    (sum, installment) =>
      sum +
      installment.principalPaidRemainingMinor +
      installment.interestPaidRemainingMinor +
      installment.feesPaidRemainingMinor +
      installment.penaltiesPaidRemainingMinor +
      installment.monitoringFeePaidRemainingMinor,
    0n,
  );
  if (leftover !== 0n) {
    return { ok: false, reason: `${leftover.toString()} minor units of installment paid totals were left unmatched`, adjustments };
  }

  return { ok: true, adjustedForRounding: adjustments.length > 0, adjustments, allocations };
}

function installmentField(key: ComponentKey) {
  switch (key) {
    case "principalMinor":
      return "principalPaidRemainingMinor";
    case "interestMinor":
      return "interestPaidRemainingMinor";
    case "feesMinor":
      return "feesPaidRemainingMinor";
    case "penaltiesMinor":
      return "penaltiesPaidRemainingMinor";
    case "monitoringFeeMinor":
      return "monitoringFeePaidRemainingMinor";
  }
}

function sumInstallmentComponent(installments: readonly LegacyAllocationInstallment[], key: ReturnType<typeof installmentField>) {
  return installments.reduce((sum, installment) => sum + installment[key], 0n);
}

function sumTransactionComponent(transactions: readonly LegacyAllocationTransaction[], key: ComponentKey) {
  return transactions.reduce((sum, transaction) => sum + transaction[key], 0n);
}

function componentTotal(value: Pick<LegacyAllocationTransaction, ComponentKey> | LegacyTransactionInstallmentAllocation) {
  return value.principalMinor + value.interestMinor + value.feesMinor + value.penaltiesMinor + value.monitoringFeeMinor;
}

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function take(capacity: bigint, remaining: bigint) {
  if (capacity <= 0n || remaining <= 0n) return 0n;
  return capacity < remaining ? capacity : remaining;
}

export type AllocatableInstallment = Readonly<{
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

export type InstallmentAllocation = Readonly<{
  installmentId: string;
  principalMinor: bigint;
  interestMinor: bigint;
  feesMinor: bigint;
  penaltiesMinor: bigint;
}>;

export function allocateRepayment(installments: readonly AllocatableInstallment[], paymentMinor: bigint) {
  if (paymentMinor <= 0n) throw new Error("Repayment must be positive");
  let remaining = paymentMinor;
  const sorted = [...installments].sort((left, right) => left.dueOn.getTime() - right.dueOn.getTime() || left.installmentNumber - right.installmentNumber);
  const allocations: InstallmentAllocation[] = [];

  for (const installment of sorted) {
    const allocation = { installmentId: installment.id, principalMinor: 0n, interestMinor: 0n, feesMinor: 0n, penaltiesMinor: 0n };
    allocation.penaltiesMinor = take(installment.penaltiesDueMinor - installment.penaltiesPaidMinor, remaining); remaining -= allocation.penaltiesMinor;
    allocation.feesMinor = take(installment.feesDueMinor - installment.feesPaidMinor, remaining); remaining -= allocation.feesMinor;
    allocation.interestMinor = take(installment.interestDueMinor - installment.interestPaidMinor, remaining); remaining -= allocation.interestMinor;
    allocation.principalMinor = take(installment.principalDueMinor - installment.principalPaidMinor, remaining); remaining -= allocation.principalMinor;
    if (allocation.principalMinor + allocation.interestMinor + allocation.feesMinor + allocation.penaltiesMinor > 0n) allocations.push(allocation);
    if (remaining === 0n) break;
  }

  return {
    allocations,
    principalMinor: allocations.reduce((sum, item) => sum + item.principalMinor, 0n),
    interestMinor: allocations.reduce((sum, item) => sum + item.interestMinor, 0n),
    feesMinor: allocations.reduce((sum, item) => sum + item.feesMinor, 0n),
    penaltiesMinor: allocations.reduce((sum, item) => sum + item.penaltiesMinor, 0n),
    overpaymentMinor: remaining,
  };
}

function take(outstanding: bigint, available: bigint) {
  if (outstanding <= 0n || available <= 0n) return 0n;
  return outstanding < available ? outstanding : available;
}
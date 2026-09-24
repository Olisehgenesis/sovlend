import { formatMinor } from "@/modules/money/domain/format-minor";

export type RepaymentAllocationSplit = Readonly<{
  principalMinor: bigint;
  interestMinor: bigint;
  feesMinor: bigint;
  monitoringFeeMinor: bigint;
  penaltiesMinor: bigint;
}>;

export function repaymentSplitFromAllocations(
  allocations: readonly {
    principalMinor: bigint;
    interestMinor: bigint;
    feesMinor: bigint;
    monitoringFeeMinor?: bigint | null;
    penaltiesMinor: bigint;
  }[],
): RepaymentAllocationSplit {
  return allocations.reduce<RepaymentAllocationSplit>(
    (sum, item) => ({
      principalMinor: sum.principalMinor + item.principalMinor,
      interestMinor: sum.interestMinor + item.interestMinor,
      feesMinor: sum.feesMinor + item.feesMinor,
      monitoringFeeMinor: sum.monitoringFeeMinor + (item.monitoringFeeMinor ?? 0n),
      penaltiesMinor: sum.penaltiesMinor + item.penaltiesMinor,
    }),
    { principalMinor: 0n, interestMinor: 0n, feesMinor: 0n, monitoringFeeMinor: 0n, penaltiesMinor: 0n },
  );
}

export function repaymentSplitToJson(split: RepaymentAllocationSplit) {
  return {
    principalMinor: split.principalMinor.toString(),
    interestMinor: split.interestMinor.toString(),
    feesMinor: split.feesMinor.toString(),
    monitoringFeeMinor: split.monitoringFeeMinor.toString(),
    penaltiesMinor: split.penaltiesMinor.toString(),
  };
}

export function repaymentRecordedMessage(
  split: {
    principalMinor?: string | null;
    interestMinor?: string | null;
    feesMinor?: string | null;
    monitoringFeeMinor?: string | null;
    penaltiesMinor?: string | null;
  },
  currencyCode = "UGX",
) {
  const money = (value: string | null | undefined) => formatMinor(BigInt(value || "0"), currencyCode);
  const parts = [
    `Principal ${money(split.principalMinor)}`,
    `Interest ${money(split.interestMinor)}`,
  ];
  if (BigInt(split.monitoringFeeMinor || "0") > 0n) parts.push(`Maintenance ${money(split.monitoringFeeMinor)}`);
  if (BigInt(split.feesMinor || "0") > 0n) parts.push(`Fees ${money(split.feesMinor)}`);
  if (BigInt(split.penaltiesMinor || "0") > 0n) parts.push(`Penalties ${money(split.penaltiesMinor)}`);
  return `Repayment recorded · ${parts.join(" · ")}`;
}

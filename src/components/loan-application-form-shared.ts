export type ProductOption = Readonly<{
  id: string;
  name: string;
  currency: string;
  minimum: string;
  maximum: string;
  minimumMinor: string;
  maximumMinor: string;
  annualRatePercent: number;
  monitoringFeeAnnualRatePercent: number;
  repaymentCount: number;
  repaymentFrequency: string;
  interestMethod: string;
  amortizationMethod: string;
}>;

export type OfficerOption = Readonly<{ id: string; name: string }>;
export type FundOption = Readonly<{ id: string; name: string }>;
export type ChargeOption = Readonly<{
  id: string;
  name: string;
  calculationType: string;
  amountMinor: string | null;
  percentageBps: number | null;
  currencyCode: string;
}>;
export type ChargeDraft = Readonly<{
  chargeDefinitionId?: string;
  name: string;
  amountMinor: string;
  collectedOn?: string;
}>;
export type CollateralDraft = { type: string; description: string; estimatedValue: string };

export function toMinor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}

export function fromMinor(value: bigint | string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  const whole = parsed / 100n;
  const fraction = (parsed % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function buildChargePayload({
  charges,
  preservedCharges = [],
  proposedPrincipalMinor,
  selectedChargeIds,
}: {
  charges: readonly ChargeOption[];
  preservedCharges?: readonly ChargeDraft[];
  proposedPrincipalMinor: string;
  selectedChargeIds: ReadonlySet<string>;
}) {
  const selectedCharges = charges
    .filter((charge) => selectedChargeIds.has(charge.id))
    .map((charge) => ({
      chargeDefinitionId: charge.id,
      name: charge.name,
      amountMinor:
        charge.calculationType === "FLAT"
          ? (charge.amountMinor ?? "0")
          : ((BigInt(proposedPrincipalMinor) * BigInt(charge.percentageBps ?? 0)) / 10_000n).toString(),
    }));
  return [...preservedCharges, ...selectedCharges];
}

export function buildCollateralPayload(collateral: readonly CollateralDraft[]) {
  return collateral
    .filter((row) => row.type.trim() || row.description.trim() || row.estimatedValue.trim())
    .map((row) => ({
      type: row.type.trim() || undefined,
      description: row.description.trim() || undefined,
      estimatedValueMinor: toMinor(row.estimatedValue) ?? undefined,
    }));
}

export function buildTermsPayload({
  amortizationMethod,
  annualRatePercent,
  arrearsTolerance,
  firstRepaymentOn,
  interestMethod,
  monitoringFeeAnnualRatePercent,
  repaymentCount,
  repaymentFrequency,
}: {
  amortizationMethod: string;
  annualRatePercent: string;
  arrearsTolerance: string;
  firstRepaymentOn: string;
  interestMethod: string;
  monitoringFeeAnnualRatePercent: string;
  repaymentCount: string;
  repaymentFrequency: string;
}) {
  return {
    annualRateBps: annualRatePercent ? Math.round(Number(annualRatePercent) * 100) : undefined,
    monitoringFeeAnnualRateBps: monitoringFeeAnnualRatePercent ? Math.round(Number(monitoringFeeAnnualRatePercent) * 100) : undefined,
    repaymentCount: repaymentCount ? Number(repaymentCount) : undefined,
    repaymentFrequency: repaymentFrequency.trim() || undefined,
    interestMethod: interestMethod.trim() || undefined,
    amortizationMethod: amortizationMethod.trim() || undefined,
    firstRepaymentOn: firstRepaymentOn || undefined,
    arrearsToleranceMinor: toMinor(arrearsTolerance) ?? undefined,
  };
}

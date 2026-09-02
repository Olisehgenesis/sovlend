import Decimal from "decimal.js";

export type CurrencyDefinition = Readonly<{
  code: string;
  exponent: number;
}>;

export type Money = Readonly<{
  amountMinor: bigint;
  currency: CurrencyDefinition;
}>;

export function money(amountMinor: bigint, currency: CurrencyDefinition): Money {
  return { amountMinor, currency };
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor + right.amountMinor, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function formatMoney(value: Money): string {
  const scale = new Decimal(10).pow(value.currency.exponent);
  return new Decimal(value.amountMinor.toString()).div(scale).toFixed(value.currency.exponent);
}

export function convertMoney(
  value: Money,
  target: CurrencyDefinition,
  targetMinorPerSourceUnit: Decimal.Value,
): Money {
  const sourceScale = new Decimal(10).pow(value.currency.exponent);
  const converted = new Decimal(value.amountMinor.toString())
    .div(sourceScale)
    .mul(targetMinorPerSourceUnit)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  return money(BigInt(converted.toFixed(0)), target);
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency.code !== right.currency.code || left.currency.exponent !== right.currency.exponent) {
    throw new Error(`Currency mismatch: ${left.currency.code} and ${right.currency.code}`);
  }
}
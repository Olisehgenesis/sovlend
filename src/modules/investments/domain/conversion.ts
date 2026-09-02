import Decimal from "decimal.js";

export function contributionToSats(input: {
  amountMinor: bigint;
  currencyCode: "UGX" | "USD";
  btcUsd: string;
  usdUgx?: string;
}): bigint {
  if (input.amountMinor <= 0n) throw new Error("Investment amount must be positive");
  const amount = new Decimal(input.amountMinor.toString());
  const usd = input.currencyCode === "USD"
    ? amount.div(100)
    : amount.div(new Decimal(input.usdUgx ?? (() => { throw new Error("USD/UGX rate is required"); })()));
  return BigInt(usd.div(input.btcUsd).mul(100_000_000).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0));
}
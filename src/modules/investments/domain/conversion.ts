import Decimal from "decimal.js";

export function contributionToSats(input: {
  amountMinor: bigint;
  currencyCode: "UGX" | "USD";
  btcUsd: string;
  usdUgx?: string;
}): bigint {
  if (input.amountMinor <= 0n) throw new Error("Investment amount must be positive");
  // amountMinor is always stored ×100-scaled (2 decimal places), matching the money convention
  // used everywhere else in the app (repayments, savings, ledger) -- even for UGX, which has no
  // real subunit. Normalize both currencies to major units the same way before converting.
  const amount = new Decimal(input.amountMinor.toString()).div(100);
  const usd = input.currencyCode === "USD"
    ? amount
    : amount.div(new Decimal(input.usdUgx ?? (() => { throw new Error("USD/UGX rate is required"); })()));
  return BigInt(usd.div(input.btcUsd).mul(100_000_000).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0));
}
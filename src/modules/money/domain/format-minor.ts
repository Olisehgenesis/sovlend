export function formatMinor(amount: bigint, currencyCode: string) {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const sign = negative ? "-" : "";
  if (currencyCode === "BTC") {
    const whole = abs / 100_000_000n;
    const fraction = (abs % 100_000_000n).toString().padStart(8, "0");
    return `${sign}${whole}.${fraction} BTC`;
  }
  if (currencyCode === "USDC" || currencyCode === "USD" || currencyCode === "UGX") {
    const exponent = currencyCode === "USDC" ? 1_000_000n : 100n;
    const decimals = currencyCode === "USDC" ? 6 : 2;
    const whole = abs / exponent;
    const fraction = (abs % exponent).toString().padStart(decimals, "0");
    return `${sign}${currencyCode} ${whole.toLocaleString("en-UG")}.${fraction}`;
  }
  return `${sign}${currencyCode} ${abs.toLocaleString("en-UG")}`;
}
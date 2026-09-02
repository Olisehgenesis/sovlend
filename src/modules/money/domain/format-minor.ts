export function formatMinor(amount: bigint, currencyCode: string) {
  if (currencyCode === "BTC") {
    const whole = amount / 100_000_000n;
    const fraction = (amount % 100_000_000n).toString().padStart(8, "0");
    return `${whole}.${fraction} BTC`;
  }
  if (currencyCode === "USDC" || currencyCode === "USD" || currencyCode === "UGX") {
    const exponent = currencyCode === "USDC" ? 1_000_000n : 100n;
    const decimals = currencyCode === "USDC" ? 6 : 2;
    const whole = amount / exponent;
    const fraction = (amount % exponent).toString().padStart(decimals, "0");
    return `${currencyCode} ${whole.toLocaleString("en-UG")}.${fraction}`;
  }
  return `${currencyCode} ${amount.toLocaleString("en-UG")}`;
}
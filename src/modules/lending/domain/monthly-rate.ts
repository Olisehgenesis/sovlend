/** Product and application forms collect a monthly percent. Storage stays annual basis points (×12). */

export function annualBpsFromMonthlyPercent(monthlyPercent: number): number {
  if (!Number.isFinite(monthlyPercent) || monthlyPercent < 0) return 0;
  return Math.round(monthlyPercent * 12 * 100);
}

export function monthlyPercentFromAnnualBps(annualBps: number): number {
  return annualBps / 1_200;
}

export function formatMonthlyPercent(annualBps: number): string {
  const value = monthlyPercentFromAnnualBps(annualBps);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(4)));
}

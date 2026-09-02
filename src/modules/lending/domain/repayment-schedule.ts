import Decimal from "decimal.js";

export type RepaymentFrequency = Readonly<{ every: number; unit: "DAYS" | "WEEKS" | "MONTHS" }>;

export type ScheduleTerms = Readonly<{
  principalMinor: bigint;
  annualRateBps: number;
  repaymentCount: number;
  repaymentFrequency: string;
  interestMethod: string;
  disbursedOn: Date;
}>;

export type ScheduledInstallment = Readonly<{
  installmentNumber: number;
  dueOn: Date;
  principalDueMinor: bigint;
  interestDueMinor: bigint;
}>;

export function generateRepaymentSchedule(terms: ScheduleTerms): ScheduledInstallment[] {
  if (terms.principalMinor <= 0n) throw new Error("Principal must be positive");
  if (!Number.isInteger(terms.repaymentCount) || terms.repaymentCount <= 0) throw new Error("Repayment count must be positive");
  if (!Number.isInteger(terms.annualRateBps) || terms.annualRateBps < 0) throw new Error("Annual rate must be non-negative basis points");
  const frequency = parseRepaymentFrequency(terms.repaymentFrequency);
  const periodicRate = getPeriodicRate(terms.annualRateBps, frequency);
  const method = normalizeInterestMethod(terms.interestMethod);
  const installments = method === "FLAT"
    ? flatSchedule(terms.principalMinor, terms.repaymentCount, periodicRate)
    : decliningSchedule(terms.principalMinor, terms.repaymentCount, periodicRate);

  return installments.map((installment, index) => ({
    installmentNumber: index + 1,
    dueOn: addFrequency(terms.disbursedOn, frequency, index + 1),
    ...installment,
  }));
}

export function parseRepaymentFrequency(value: string): RepaymentFrequency {
  const match = value.trim().toUpperCase().match(/^(\d+)\s+(DAY|DAYS|WEEK|WEEKS|MONTH|MONTHS)$/);
  if (!match) throw new Error(`Unsupported repayment frequency: ${value}`);
  const every = Number.parseInt(match[1], 10);
  if (every <= 0) throw new Error("Repayment frequency must be positive");
  const rawUnit = match[2];
  const unit = rawUnit.startsWith("DAY") ? "DAYS" : rawUnit.startsWith("WEEK") ? "WEEKS" : "MONTHS";
  return { every, unit };
}

function flatSchedule(principal: bigint, count: number, periodicRate: Decimal) {
  const totalInterest = decimalToMinor(new Decimal(principal.toString()).mul(periodicRate).mul(count));
  const principalBase = principal / BigInt(count);
  const interestBase = totalInterest / BigInt(count);
  const principalRemainder = principal - principalBase * BigInt(count);
  const interestRemainder = totalInterest - interestBase * BigInt(count);

  return Array.from({ length: count }, (_, index) => ({
    principalDueMinor: principalBase + (index === count - 1 ? principalRemainder : 0n),
    interestDueMinor: interestBase + (index === count - 1 ? interestRemainder : 0n),
  }));
}

function decliningSchedule(principal: bigint, count: number, periodicRate: Decimal) {
  if (periodicRate.isZero()) return flatSchedule(principal, count, periodicRate);
  const principalDecimal = new Decimal(principal.toString());
  const factor = periodicRate.add(1).pow(count);
  const payment = principalDecimal.mul(periodicRate).mul(factor).div(factor.sub(1));
  let balance = principal;

  return Array.from({ length: count }, (_, index) => {
    const interest = decimalToMinor(new Decimal(balance.toString()).mul(periodicRate));
    const scheduledPrincipal = decimalToMinor(payment.sub(interest));
    const principalDue = index === count - 1 ? balance : minBigInt(scheduledPrincipal, balance);
    balance -= principalDue;
    return { principalDueMinor: principalDue, interestDueMinor: interest };
  });
}

function getPeriodicRate(annualRateBps: number, frequency: RepaymentFrequency) {
  const annual = new Decimal(annualRateBps).div(10_000);
  if (frequency.unit === "MONTHS") return annual.mul(frequency.every).div(12);
  const days = frequency.unit === "WEEKS" ? frequency.every * 7 : frequency.every;
  return annual.mul(days).div(365);
}

function addFrequency(start: Date, frequency: RepaymentFrequency, periods: number) {
  const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const amount = frequency.every * periods;
  if (frequency.unit === "DAYS") date.setUTCDate(date.getUTCDate() + amount);
  if (frequency.unit === "WEEKS") date.setUTCDate(date.getUTCDate() + amount * 7);
  if (frequency.unit === "MONTHS") {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + amount);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date;
}

function normalizeInterestMethod(value: string) {
  const normalized = value.trim().toUpperCase().replaceAll(" ", "_");
  if (normalized === "FLAT") return "FLAT";
  if (normalized === "DECLINING_BALANCE") return "DECLINING_BALANCE";
  throw new Error(`Unsupported interest method: ${value}`);
}

function decimalToMinor(value: Decimal) {
  return BigInt(value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}
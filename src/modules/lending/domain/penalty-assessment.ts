import { z } from "zod";

import { installmentOutstandingMinor } from "./loan-outstanding";

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

const lateFeeRuleSchema = z
  .object({
    graceDays: z.number().int().nonnegative(),
    calculationType: z.enum(["FLAT", "PERCENT_OF_OVERDUE"]),
    amountMinor: z.string().regex(/^\d+$/).optional(),
    percentageBps: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, context) => {
    if (value.calculationType === "FLAT" && value.amountMinor === undefined) {
      context.addIssue({
        code: "custom",
        message: "FLAT late fee rules require amountMinor",
        path: ["amountMinor"],
      });
    }
    if (value.calculationType === "PERCENT_OF_OVERDUE" && value.percentageBps === undefined) {
      context.addIssue({
        code: "custom",
        message: "PERCENT_OF_OVERDUE late fee rules require percentageBps",
        path: ["percentageBps"],
      });
    }
  });

export type LateFeeRule = z.infer<typeof lateFeeRuleSchema>;

export type PenaltyBaseInstallment = Readonly<{
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  principalWaivedMinor?: bigint;
  interestWaivedMinor?: bigint;
  feesDueMinor?: bigint;
  penaltiesDueMinor?: bigint;
  feesPaidMinor?: bigint;
  penaltiesPaidMinor?: bigint;
  feesWaivedMinor?: bigint;
  penaltiesWaivedMinor?: bigint;
  monitoringFeeDueMinor?: bigint;
  monitoringFeePaidMinor?: bigint;
  monitoringFeeWaivedMinor?: bigint;
}>;

export function parseLateFeeRule(input: unknown): LateFeeRule | null {
  if (input == null) return null;
  return lateFeeRuleSchema.parse(input);
}

export function computePenaltyAmountMinor(rule: LateFeeRule, installment: PenaltyBaseInstallment): bigint {
  if (rule.calculationType === "FLAT") {
    return BigInt(rule.amountMinor!);
  }

  const overdueBaseMinor = installmentOutstandingMinor({
    principalDueMinor: installment.principalDueMinor,
    interestDueMinor: installment.interestDueMinor,
    feesDueMinor: 0n,
    penaltiesDueMinor: 0n,
    principalPaidMinor: installment.principalPaidMinor,
    interestPaidMinor: installment.interestPaidMinor,
    feesPaidMinor: 0n,
    penaltiesPaidMinor: 0n,
    principalWaivedMinor: installment.principalWaivedMinor ?? 0n,
    interestWaivedMinor: installment.interestWaivedMinor ?? 0n,
    feesWaivedMinor: 0n,
    penaltiesWaivedMinor: 0n,
    monitoringFeeDueMinor: 0n,
    monitoringFeePaidMinor: 0n,
    monitoringFeeWaivedMinor: 0n,
  });

  return (overdueBaseMinor * BigInt(rule.percentageBps!)) / 10_000n;
}

export function isInstallmentPenaltyAssessable(input: {
  dueOn: Date;
  graceDays: number;
  today: Date;
  penaltyAssessedOn: Date | null;
  lookbackBufferDays?: number;
}): boolean {
  if (input.penaltyAssessedOn) return false;
  if (!Number.isInteger(input.graceDays) || input.graceDays < 0) {
    throw new Error("graceDays must be a non-negative integer");
  }

  const lookbackBufferDays = input.lookbackBufferDays ?? 3;
  if (!Number.isInteger(lookbackBufferDays) || lookbackBufferDays < 0) {
    throw new Error("lookbackBufferDays must be a non-negative integer");
  }

  // V1 is strictly one-time: once the grace-crossing day is missed by more than the small
  // scheduler-resilience buffer, this installment is never assessed retroactively.
  const assessableOn = addUtcDays(input.dueOn, input.graceDays);
  const daysSinceAssessable = diffUtcDays(input.today, assessableOn);
  return daysSinceAssessable >= 0 && daysSinceAssessable <= lookbackBufferDays;
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const result = toUtcDay(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function diffUtcDays(left: Date, right: Date): number {
  return Math.floor((toUtcDay(left).getTime() - toUtcDay(right).getTime()) / DAY_IN_MS);
}

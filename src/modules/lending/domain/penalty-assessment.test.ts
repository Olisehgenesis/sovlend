import { describe, expect, it } from "vitest";

import {
  computePenaltyAmountMinor,
  isInstallmentPenaltyAssessable,
  parseLateFeeRule,
} from "./penalty-assessment";

describe("penalty assessment", () => {
  it("returns no penalty configuration for null or missing lateFeeRule", () => {
    expect(parseLateFeeRule(null)).toBeNull();
    expect(parseLateFeeRule(undefined)).toBeNull();
  });

  it("computes flat penalties from the configured amountMinor", () => {
    const rule = parseLateFeeRule({
      graceDays: 5,
      calculationType: "FLAT",
      amountMinor: "1500",
    });

    expect(rule).not.toBeNull();
    expect(
      computePenaltyAmountMinor(rule!, {
        principalDueMinor: 100_000n,
        interestDueMinor: 10_000n,
        principalPaidMinor: 0n,
        interestPaidMinor: 10_000n,
      }),
    ).toBe(1_500n);
  });

  it("computes percentage penalties from outstanding principal plus interest only", () => {
    const rule = parseLateFeeRule({
      graceDays: 2,
      calculationType: "PERCENT_OF_OVERDUE",
      percentageBps: 500,
    });

    expect(rule).not.toBeNull();
    expect(
      computePenaltyAmountMinor(rule!, {
        principalDueMinor: 100_000n,
        interestDueMinor: 20_000n,
        feesDueMinor: 9_999n,
        penaltiesDueMinor: 7_777n,
        monitoringFeeDueMinor: 5_555n,
        principalPaidMinor: 30_000n,
        interestPaidMinor: 5_000n,
        feesPaidMinor: 9_999n,
        penaltiesPaidMinor: 7_777n,
        monitoringFeePaidMinor: 5_555n,
        principalWaivedMinor: 10_000n,
        interestWaivedMinor: 5_000n,
        feesWaivedMinor: 9_999n,
        penaltiesWaivedMinor: 7_777n,
        monitoringFeeWaivedMinor: 5_555n,
      }),
    ).toBe(3_500n);
  });

  it("becomes assessable exactly on the grace crossing day", () => {
    expect(
      isInstallmentPenaltyAssessable({
        dueOn: new Date("2026-09-01T00:00:00.000Z"),
        graceDays: 3,
        today: new Date("2026-09-04T12:30:00.000Z"),
        penaltyAssessedOn: null,
      }),
    ).toBe(true);
  });

  it("remains assessable within the small lookback buffer", () => {
    expect(
      isInstallmentPenaltyAssessable({
        dueOn: new Date("2026-09-01T00:00:00.000Z"),
        graceDays: 3,
        today: new Date("2026-09-07T00:00:00.000Z"),
        penaltyAssessedOn: null,
      }),
    ).toBe(true);
  });

  it("is not assessable before the grace period ends", () => {
    expect(
      isInstallmentPenaltyAssessable({
        dueOn: new Date("2026-09-01T00:00:00.000Z"),
        graceDays: 3,
        today: new Date("2026-09-03T23:59:59.000Z"),
        penaltyAssessedOn: null,
      }),
    ).toBe(false);
  });

  it("is never assessable retroactively beyond the bounded lookback buffer", () => {
    expect(
      isInstallmentPenaltyAssessable({
        dueOn: new Date("2026-09-01T00:00:00.000Z"),
        graceDays: 3,
        today: new Date("2026-09-08T00:00:00.000Z"),
        penaltyAssessedOn: null,
      }),
    ).toBe(false);
  });

  it("is not assessable once a penalty has already been assessed", () => {
    expect(
      isInstallmentPenaltyAssessable({
        dueOn: new Date("2026-09-01T00:00:00.000Z"),
        graceDays: 3,
        today: new Date("2026-09-04T00:00:00.000Z"),
        penaltyAssessedOn: new Date("2026-09-04T00:00:00.000Z"),
      }),
    ).toBe(false);
  });
});

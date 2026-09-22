import { describe, expect, it } from "vitest";

import {
  buildDisbursementPayout,
  buildDisbursementPayoutChoice,
  extraDisbursementChargesMinor,
  percentOfMinor,
} from "./disbursement-payout";

describe("disbursement payout", () => {
  it("holds 15% in LIF, takes 2% processing and 15,000 CRB, and leaves the rest to withdraw", () => {
    const payout = buildDisbursementPayout({
      principalMinor: 70_000_000n,
      existingLifMinor: 0n,
      remainingActivePrincipalMinor: 0n,
      extraChargesMinor: 0n,
    });

    expect(payout.lifRequiredMinor).toBe(10_500_000n);
    expect(payout.lifHeldFromProceedsMinor).toBe(10_500_000n);
    expect(payout.processingFeeMinor).toBe(1_400_000n);
    expect(payout.crbPayableMinor).toBe(1_000_000n);
    expect(payout.crbIncomeMinor).toBe(500_000n);
    expect(payout.withdrawableMinor).toBe(56_600_000n);
  });

  it("tops LIF up to 15% of every active loan when keeping the previous loan", () => {
    const payout = buildDisbursementPayout({
      principalMinor: 70_000_000n,
      existingLifMinor: 10_500_000n,
      remainingActivePrincipalMinor: 70_000_000n,
      extraChargesMinor: 0n,
    });

    expect(payout.lifRequiredMinor).toBe(21_000_000n);
    expect(payout.lifHeldFromProceedsMinor).toBe(10_500_000n);
    expect(payout.lifReleasedToSecurityMinor).toBe(0n);
    expect(payout.withdrawableMinor).toBe(56_600_000n);
  });

  it("releases surplus LIF into loan security payable when the new 15% is smaller", () => {
    const payout = buildDisbursementPayout({
      principalMinor: 40_000_000n,
      existingLifMinor: 10_500_000n,
      remainingActivePrincipalMinor: 0n,
      extraChargesMinor: 0n,
    });

    expect(payout.lifRequiredMinor).toBe(6_000_000n);
    expect(payout.lifHeldFromProceedsMinor).toBe(0n);
    expect(payout.lifReleasedToSecurityMinor).toBe(4_500_000n);
    expect(payout.processingFeeMinor).toBe(800_000n);
    expect(payout.withdrawableMinor).toBe(42_200_000n);
  });

  it("ignores catalog processing/CRB/LIF charges so statutory deductions are not doubled", () => {
    expect(
      extraDisbursementChargesMinor([
        { name: "Loan processing fee", amountMinor: 1_000_000n },
        { name: "Admission fee", amountMinor: 40_000n },
        { name: "CRB", amountMinor: 1_500_000n },
      ]),
    ).toBe(40_000n);
  });

  it("liquidates the old loan from withdrawable proceeds when they cover the outstanding", () => {
    const choice = buildDisbursementPayoutChoice({
      principalMinor: 70_000_000n,
      existingLifMinor: 10_500_000n,
      extraChargesMinor: 0n,
      liquidateLoanId: "old-loan",
      otherLoans: [{ id: "old-loan", principalMinor: 70_000_000n, outstandingMinor: 20_000_000n }],
    });

    expect(choice.fullyClosesPrevious).toBe(true);
    expect(choice.payout.lifRequiredMinor).toBe(10_500_000n);
    expect(choice.payout.lifHeldFromProceedsMinor).toBe(0n);
    expect(choice.payoffMinor).toBe(20_000_000n);
    expect(choice.remainingWithdrawMinor).toBe(choice.payout.withdrawableMinor - 20_000_000n);
  });

  it("keeps LIF for both loans when proceeds cannot fully pay off the old one", () => {
    const choice = buildDisbursementPayoutChoice({
      principalMinor: 70_000_000n,
      existingLifMinor: 10_500_000n,
      extraChargesMinor: 0n,
      liquidateLoanId: "old-loan",
      otherLoans: [{ id: "old-loan", principalMinor: 70_000_000n, outstandingMinor: 80_000_000n }],
    });

    expect(choice.fullyClosesPrevious).toBe(false);
    expect(choice.payout.lifRequiredMinor).toBe(21_000_000n);
    expect(choice.payoffMinor).toBe(choice.payout.withdrawableMinor);
    expect(choice.remainingWithdrawMinor).toBe(0n);
  });

  it("rejects deductions larger than principal", () => {
    expect(() =>
      buildDisbursementPayout({
        principalMinor: 1_000_000n,
        existingLifMinor: 0n,
        remainingActivePrincipalMinor: 0n,
        extraChargesMinor: 0n,
      }),
    ).toThrow("Disbursement deductions exceed the approved principal");
  });

  it("uses integer basis-point math", () => {
    expect(percentOfMinor(70_000_000n, 1_500)).toBe(10_500_000n);
    expect(percentOfMinor(70_000_000n, 200)).toBe(1_400_000n);
  });
});

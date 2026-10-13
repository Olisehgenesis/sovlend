import { describe, expect, it } from "vitest";

import {
  buildDisbursementPayout,
  buildDisbursementPayoutChoice,
  extraDisbursementChargesMinor,
  percentOfMinor,
  disbursementOverviewRows,
  disbursementCashToMemberMinor,
  statutoryDisbursementChargeSpecs,
} from "./disbursement-payout";

describe("disbursement payout", () => {
  it.each([0n, 45000000n])("exempts one loan without moving existing LIF savings (%s)", existingLifMinor => {
    const choice = buildDisbursementPayoutChoice({
      principalMinor: 300000000n, existingLifMinor, extraChargesMinor: 0n, lifExempt: true,
      liquidateLoanId: "old", otherLoans: [{ id: "old", principalMinor: 300000000n, outstandingMinor: 4203846n }],
    });
    expect(choice.payout.lifHeldFromProceedsMinor).toBe(0n);
    expect(choice.payout.lifReleasedToSecurityMinor).toBe(0n);
    expect(choice.payout.withdrawableMinor).toBe(292500000n);
    expect(choice.payoffMinor).toBe(4203846n);
    expect(choice.remainingWithdrawMinor).toBe(288296154n);
    expect(disbursementOverviewRows({ principalMinor: 300000000n, disbursed: false, lifExempt: true }).some(row => row.key === "lif")).toBe(false);
  });
  it("does not require LIF on an exempt active loan when a later normal loan is disbursed", () => {
    const choice = buildDisbursementPayoutChoice({
      principalMinor: 70000000n, existingLifMinor: 0n, extraChargesMinor: 0n,
      otherLoans: [{ id: "exempt", principalMinor: 300000000n, outstandingMinor: 200000000n, lifExempt: true }],
    });
    expect(choice.payout.lifRequiredMinor).toBe(10500000n);
  });
  it.each([500, 600, 0])("uses a %i bps processing rate consistently in preview and overview", (bps) => {
    const p = buildDisbursementPayout({ principalMinor: 300_000_000n, existingLifMinor: 0n, remainingActivePrincipalMinor: 0n, extraChargesMinor: 0n, processingFeeBps: bps });
    expect(p.processingFeeMinor).toBe(300_000_000n * BigInt(bps) / 10_000n);
    expect(p.crbTotalMinor).toBe(1_500_000n);
    expect(p.withdrawableMinor).toBe(300_000_000n - 45_000_000n - p.processingFeeMinor - 1_500_000n);
    expect(disbursementOverviewRows({ principalMinor: 300_000_000n, disbursed: true, processingFeeBps: bps }).find(r => r.key === "processing")?.paid ?? 0n).toBe(p.processingFeeMinor);
  });
  it("rejects invalid rates and excessive deductions", () => {
    const input = { principalMinor: 300_000_000n, existingLifMinor: 0n, remainingActivePrincipalMinor: 0n, extraChargesMinor: 0n };
    for (const processingFeeBps of [-1, 10001, 5.5, NaN]) expect(() => buildDisbursementPayout({ ...input, processingFeeBps })).toThrow();
    expect(() => buildDisbursementPayout({ ...input, processingFeeBps: 10000 })).toThrow("deductions exceed");
  });
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

  it("shows LIF, processing, and CRB on the loan overview without adding them to outstanding", () => {
    const disbursed = disbursementOverviewRows({ principalMinor: 70_000_000n, disbursed: true });
    expect(disbursed).toEqual([
      { key: "lif", label: "Loan insurance fund", original: 10_500_000n, paid: 10_500_000n, waived: 0n, overdue: 0n, outstanding: 0n },
      { key: "processing", label: "Processing fee", original: 1_400_000n, paid: 1_400_000n, waived: 0n, overdue: 0n, outstanding: 0n },
      { key: "crb", label: "CRB", original: 1_500_000n, paid: 1_500_000n, waived: 0n, overdue: 0n, outstanding: 0n },
    ]);
    expect(disbursementOverviewRows({ principalMinor: 70_000_000n, disbursed: false }).every((row) => row.paid === 0n)).toBe(true);
  });

  it("sends LIF surplus to security payable and the rest to member contributions", () => {
    const payout = buildDisbursementPayout({
      principalMinor: 40_000_000n,
      existingLifMinor: 10_500_000n,
      remainingActivePrincipalMinor: 0n,
      extraChargesMinor: 0n,
    });
    expect(payout.lifReleasedToSecurityMinor).toBe(4_500_000n);
    expect(disbursementCashToMemberMinor(payout)).toBe(37_700_000n);
  });

  it("lists processing and split CRB as named charge specs", () => {
    const payout = buildDisbursementPayout({
      principalMinor: 70_000_000n,
      existingLifMinor: 0n,
      remainingActivePrincipalMinor: 0n,
      extraChargesMinor: 0n,
    });
    expect(statutoryDisbursementChargeSpecs(payout)).toEqual([
      { name: "Processing fee", amountMinor: 1_400_000n },
      { name: "CRB income", amountMinor: 500_000n },
      { name: "CRB fee", amountMinor: 1_000_000n },
    ]);
  });

  it("collects compulsory CRB even when a legacy product has it disabled, preserving historical overview behavior", () => {
    const payout = buildDisbursementPayout({
      principalMinor: 70_000_000n,
      existingLifMinor: 0n,
      remainingActivePrincipalMinor: 0n,
      extraChargesMinor: 0n,
      collectCrb: false,
    });
    expect(payout.crbTotalMinor).toBe(1_500_000n);
    expect(payout.crbIncomeMinor).toBe(500_000n);
    expect(payout.crbPayableMinor).toBe(1_000_000n);
    expect(payout.withdrawableMinor).toBe(56_600_000n);
    expect(statutoryDisbursementChargeSpecs(payout)).toEqual([
      { name: "Processing fee", amountMinor: 1_400_000n },
      { name: "CRB income", amountMinor: 500_000n },
      { name: "CRB fee", amountMinor: 1_000_000n },
    ]);
    expect(disbursementOverviewRows({ principalMinor: 70_000_000n, disbursed: true, collectCrb: false }).some((row) => row.key === "crb")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { reconcileLegacyLoanAllocations, type LegacyAllocationInstallment, type LegacyAllocationTransaction } from "./legacy-loan-allocation-reconciliation";

const installments: LegacyAllocationInstallment[] = [
  {
    id: "installment-1",
    dueOn: new Date("2026-08-01T00:00:00.000Z"),
    installmentNumber: 1,
    principalPaidRemainingMinor: 7_000n,
    interestPaidRemainingMinor: 1_000n,
    feesPaidRemainingMinor: 0n,
    penaltiesPaidRemainingMinor: 0n,
    monitoringFeePaidRemainingMinor: 0n,
  },
  {
    id: "installment-2",
    dueOn: new Date("2026-09-01T00:00:00.000Z"),
    installmentNumber: 2,
    principalPaidRemainingMinor: 3_000n,
    interestPaidRemainingMinor: 500n,
    feesPaidRemainingMinor: 0n,
    penaltiesPaidRemainingMinor: 0n,
    monitoringFeePaidRemainingMinor: 0n,
  },
];

const transactions: LegacyAllocationTransaction[] = [
  {
    id: "tx-1",
    businessDate: new Date("2026-08-10T00:00:00.000Z"),
    sortKey: 1,
    principalMinor: 5_000n,
    interestMinor: 1_000n,
    feesMinor: 0n,
    penaltiesMinor: 0n,
    monitoringFeeMinor: 0n,
  },
  {
    id: "tx-2",
    businessDate: new Date("2026-09-10T00:00:00.000Z"),
    sortKey: 2,
    principalMinor: 5_000n,
    interestMinor: 500n,
    feesMinor: 0n,
    penaltiesMinor: 0n,
    monitoringFeeMinor: 0n,
  },
];

describe("reconcileLegacyLoanAllocations", () => {
  it("reconstructs exact installment allocations chronologically", () => {
    const result = reconcileLegacyLoanAllocations(installments, transactions);
    expect(result).toMatchObject({ ok: true, adjustedForRounding: false });
    if (!result.ok) throw new Error("expected success");
    expect(result.allocations).toEqual([
      {
        transactionId: "tx-1",
        installmentId: "installment-1",
        principalMinor: 5_000n,
        interestMinor: 1_000n,
        feesMinor: 0n,
        penaltiesMinor: 0n,
        monitoringFeeMinor: 0n,
      },
      {
        transactionId: "tx-2",
        installmentId: "installment-1",
        principalMinor: 2_000n,
        interestMinor: 0n,
        feesMinor: 0n,
        penaltiesMinor: 0n,
        monitoringFeeMinor: 0n,
      },
      {
        transactionId: "tx-2",
        installmentId: "installment-2",
        principalMinor: 3_000n,
        interestMinor: 500n,
        feesMinor: 0n,
        penaltiesMinor: 0n,
        monitoringFeeMinor: 0n,
      },
    ]);
  });

  it("absorbs a small rounding delta into the latest transaction", () => {
    const result = reconcileLegacyLoanAllocations(installments, [
      transactions[0],
      { ...transactions[1], principalMinor: 4_999n },
    ]);
    expect(result).toMatchObject({ ok: true, adjustedForRounding: true });
    if (!result.ok) throw new Error("expected success");
    expect(result.adjustments[0]).toContain("principal");
    expect(result.allocations.filter((item) => item.transactionId === "tx-2")).toEqual([
      {
        transactionId: "tx-2",
        installmentId: "installment-1",
        principalMinor: 2_000n,
        interestMinor: 0n,
        feesMinor: 0n,
        penaltiesMinor: 0n,
        monitoringFeeMinor: 0n,
      },
      {
        transactionId: "tx-2",
        installmentId: "installment-2",
        principalMinor: 3_000n,
        interestMinor: 500n,
        feesMinor: 0n,
        penaltiesMinor: 0n,
        monitoringFeeMinor: 0n,
      },
    ]);
  });

  it("flags materially unreconcilable totals", () => {
    const result = reconcileLegacyLoanAllocations(installments, [
      transactions[0],
      { ...transactions[1], principalMinor: 4_900n },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: "principalMinor totals differ by 100 minor units",
      adjustments: [],
    });
  });
});

import { describe, expect, it } from "vitest";

import { allocateRepayment, type AllocatableInstallment } from "./repayment-allocation";

const installment: AllocatableInstallment = { id: "one", dueOn: new Date("2026-09-01"), installmentNumber: 1, principalDueMinor: 10_000n, interestDueMinor: 2_000n, feesDueMinor: 500n, penaltiesDueMinor: 300n, principalPaidMinor: 0n, interestPaidMinor: 0n, feesPaidMinor: 0n, penaltiesPaidMinor: 0n };

describe("repayment allocation", () => {
  it("allocates penalties, fees, interest, then principal", () => {
    const result = allocateRepayment([installment], 3_000n);
    expect(result).toMatchObject({ penaltiesMinor: 300n, feesMinor: 500n, interestMinor: 2_000n, principalMinor: 200n, overpaymentMinor: 0n });
  });

  it("carries payment into later installments then overpayment", () => {
    const second = { ...installment, id: "two", installmentNumber: 2, dueOn: new Date("2026-10-01"), penaltiesDueMinor: 0n, feesDueMinor: 0n, interestDueMinor: 0n, principalDueMinor: 1_000n };
    const result = allocateRepayment([installment, second], 14_000n);
    expect(result.allocations.map((item) => item.installmentId)).toEqual(["one", "two"]);
    expect(result.overpaymentMinor).toBe(200n);
  });

  it("accounts for prior component payments", () => {
    const result = allocateRepayment([{ ...installment, penaltiesPaidMinor: 300n, feesPaidMinor: 500n }], 2_000n);
    expect(result.interestMinor).toBe(2_000n);
    expect(result.feesMinor + result.penaltiesMinor + result.principalMinor).toBe(0n);
  });

  it("allocates monitoring fee separately from generic fees and interest, even at equal rates", () => {
    const withMonitoringFee: AllocatableInstallment = {
      ...installment,
      feesDueMinor: 0n,
      monitoringFeeDueMinor: 500n,
      monitoringFeePaidMinor: 0n,
    };
    const result = allocateRepayment([withMonitoringFee], 800n);
    expect(result).toMatchObject({ penaltiesMinor: 300n, monitoringFeeMinor: 500n, feesMinor: 0n, interestMinor: 0n, principalMinor: 0n, overpaymentMinor: 0n });
    expect(result.allocations[0]).toMatchObject({ monitoringFeeMinor: 500n, feesMinor: 0n });
  });

  it("defaults monitoringFeeMinor to 0 for historical installments that never set the field", () => {
    const result = allocateRepayment([installment], 3_000n);
    expect(result.monitoringFeeMinor).toBe(0n);
    expect(result.allocations[0]).toMatchObject({ monitoringFeeMinor: 0n });
  });

  it("carries an installment's penaltyAssessedOn flag into the allocation when present", () => {
    const penaltyAssessedOn = new Date("2026-09-04T00:00:00.000Z");
    const result = allocateRepayment([{ ...installment, penaltyAssessedOn }], 300n);
    expect(result.allocations[0]).toMatchObject({
      installmentId: "one",
      penaltiesMinor: 300n,
      penaltyAssessedOn,
    });
  });
});
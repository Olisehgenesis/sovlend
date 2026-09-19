import { describe, expect, it } from "vitest";

import {
  installmentDueMinor,
  installmentOutstandingMinor,
  installmentPaidMinor,
  installmentWaivedMinor,
  isLoanSettledStatus,
  loanOutstandingMinor,
  loanWrittenOffMinor,
  principalOutstandingMinor,
  summarizeLoanBalance,
  installmentsWithCharges,
} from "./loan-outstanding";

const baseInstallment = {
  principalDueMinor: 100_000n,
  interestDueMinor: 10_000n,
  feesDueMinor: 0n,
  penaltiesDueMinor: 0n,
  principalPaidMinor: 0n,
  interestPaidMinor: 0n,
  feesPaidMinor: 0n,
  penaltiesPaidMinor: 0n,
};

describe("installmentDueMinor / installmentPaidMinor / installmentWaivedMinor", () => {
  it("sums the four components", () => {
    expect(installmentDueMinor(baseInstallment)).toBe(110_000n);
    expect(installmentPaidMinor({ ...baseInstallment, principalPaidMinor: 50_000n, interestPaidMinor: 5_000n })).toBe(55_000n);
  });

  it("adds optional monitoring fee fields without changing historical callers that omit them", () => {
    expect(installmentDueMinor(baseInstallment)).toBe(110_000n);
    expect(installmentPaidMinor(baseInstallment)).toBe(0n);
    expect(
      installmentDueMinor({ ...baseInstallment, monitoringFeeDueMinor: 2_500n }),
    ).toBe(112_500n);
    expect(
      installmentPaidMinor({ ...baseInstallment, monitoringFeePaidMinor: 750n }),
    ).toBe(750n);
    expect(
      installmentWaivedMinor({ ...baseInstallment, monitoringFeeWaivedMinor: 250n }),
    ).toBe(250n);
  });

  it("defaults waived fields to zero when absent", () => {
    expect(installmentWaivedMinor(baseInstallment)).toBe(0n);
    expect(installmentWaivedMinor({ ...baseInstallment, principalWaivedMinor: 20_000n, interestWaivedMinor: 2_000n })).toBe(22_000n);
  });
});

describe("installmentOutstandingMinor", () => {
  it("subtracts paid and waived from due, and never goes negative", () => {
    expect(installmentOutstandingMinor(baseInstallment)).toBe(110_000n);
    expect(
      installmentOutstandingMinor({ ...baseInstallment, principalPaidMinor: 100_000n, interestPaidMinor: 10_000n }),
    ).toBe(0n);
    expect(
      installmentOutstandingMinor({ ...baseInstallment, principalPaidMinor: 100_000n, interestWaivedMinor: 10_000n }),
    ).toBe(0n);
    // Overpayment on a single installment should clamp to zero, not go negative.
    expect(installmentOutstandingMinor({ ...baseInstallment, principalPaidMinor: 500_000n })).toBe(0n);
  });
});

describe("loanWrittenOffMinor", () => {
  it("sums the four write-off components", () => {
    expect(
      loanWrittenOffMinor({
        principalWrittenOffMinor: 90_000n,
        interestWrittenOffMinor: 10_000n,
        feesWrittenOffMinor: 0n,
        penaltiesWrittenOffMinor: 0n,
      }),
    ).toBe(100_000n);
  });
});

describe("loanOutstandingMinor", () => {
  const noWriteOff = {
    principalWrittenOffMinor: 0n,
    interestWrittenOffMinor: 0n,
    feesWrittenOffMinor: 0n,
    penaltiesWrittenOffMinor: 0n,
  };

  it("matches plain due-paid-waived arithmetic when nothing was written off", () => {
    const installments = [baseInstallment, { ...baseInstallment, principalPaidMinor: 100_000n, interestPaidMinor: 10_000n }];
    expect(loanOutstandingMinor(installments, noWriteOff)).toBe(110_000n);
  });

  it("reproduces the LEGACY-2 style bug fix: written-off loans settle to zero outstanding", () => {
    // due 110,000 - paid 10,000 - written off 100,000 = 0, matching iLend/Fineract's own
    // loan summary even though the raw installment row alone still looks unpaid.
    const installments = [{ ...baseInstallment, principalPaidMinor: 10_000n }];
    const writeOff = { ...noWriteOff, principalWrittenOffMinor: 90_000n, interestWrittenOffMinor: 10_000n };
    expect(loanOutstandingMinor(installments, writeOff)).toBe(0n);
  });

  it("never returns a negative outstanding even if write-off exceeds remaining due", () => {
    const installments = [{ ...baseInstallment, principalPaidMinor: 100_000n, interestPaidMinor: 10_000n }];
    const writeOff = { ...noWriteOff, principalWrittenOffMinor: 50_000n };
    expect(loanOutstandingMinor(installments, writeOff)).toBe(0n);
  });
});

describe("isLoanSettledStatus", () => {
  it("treats WRITTEN_OFF and CLOSED as settled", () => {
    expect(isLoanSettledStatus("WRITTEN_OFF")).toBe(true);
    expect(isLoanSettledStatus("CLOSED")).toBe(true);
  });

  it("treats open statuses as not settled", () => {
    expect(isLoanSettledStatus("ACTIVE")).toBe(false);
    expect(isLoanSettledStatus("IN_ARREARS")).toBe(false);
    expect(isLoanSettledStatus("OVERPAID")).toBe(false);
  });
});

describe("principalOutstandingMinor", () => {
  it("ignores interest/fees/penalties, unlike loanOutstandingMinor", () => {
    // Interest is fully due and unpaid here, but PAR only cares about the principal leg.
    const installments = [{ principalDueMinor: 100_000n, principalPaidMinor: 40_000n }];
    expect(principalOutstandingMinor(installments, 0n)).toBe(60_000n);
  });

  it("subtracts waived principal and never goes negative", () => {
    const installments = [{ principalDueMinor: 100_000n, principalPaidMinor: 40_000n, principalWaivedMinor: 60_000n }];
    expect(principalOutstandingMinor(installments, 0n)).toBe(0n);
    expect(principalOutstandingMinor(installments, 500_000n)).toBe(0n);
  });

  it("subtracts written-off principal at the loan level, matching loanOutstandingMinor's identity", () => {
    const installments = [{ principalDueMinor: 100_000n, principalPaidMinor: 10_000n }];
    expect(principalOutstandingMinor(installments, 90_000n)).toBe(0n);
  });
});

describe("summarizeLoanBalance", () => {
  const asOf = new Date("2026-09-19T10:00:00.000Z");
  const noWriteOff = {
    principalWrittenOffMinor: 0n,
    interestWrittenOffMinor: 0n,
    feesWrittenOffMinor: 0n,
    penaltiesWrittenOffMinor: 0n,
  };

  it("builds original / paid / waived / overdue / outstanding for each component", () => {
    const installments = [
      {
        dueOn: new Date("2026-08-01T00:00:00.000Z"),
        principalDueMinor: 50_000_000n,
        interestDueMinor: 10_000_000n,
        feesDueMinor: 2_000_000n,
        penaltiesDueMinor: 8_000_000n,
        principalPaidMinor: 30_000_000n,
        interestPaidMinor: 2_000_000n,
        feesPaidMinor: 500_000n,
        penaltiesPaidMinor: 1_000_000n,
      },
    ];
    const { rows, totals } = summarizeLoanBalance(installments, { ...noWriteOff, status: "IN_ARREARS" }, asOf);
    expect(rows.map((row) => row.key)).toEqual(["principal", "interest", "fees", "penalties"]);
    expect(rows[0]).toMatchObject({
      label: "Loan amount",
      original: 50_000_000n,
      paid: 30_000_000n,
      waived: 0n,
      overdue: 20_000_000n,
      outstanding: 20_000_000n,
    });
    expect(totals.original).toBe(70_000_000n);
    expect(totals.paid).toBe(33_500_000n);
    expect(totals.overdue).toBe(36_500_000n);
    expect(totals.outstanding).toBe(36_500_000n);
    expect(totals.outstanding).toBe(loanOutstandingMinor(installments, noWriteOff));
  });

  it("does not treat an installment due today as overdue", () => {
    const installments = [{ dueOn: new Date("2026-09-19T00:00:00.000Z"), ...baseInstallment }];
    const { rows } = summarizeLoanBalance(installments, { ...noWriteOff, status: "ACTIVE" }, asOf);
    const principal = rows.find((row) => row.key === "principal");
    expect(principal?.overdue).toBe(0n);
    expect(principal?.outstanding).toBe(100_000n);
  });

  it("zeroes overdue on written-off loans", () => {
    const installments = [{ dueOn: new Date("2026-01-01T00:00:00.000Z"), ...baseInstallment }];
    const { totals } = summarizeLoanBalance(
      installments,
      {
        principalWrittenOffMinor: 100_000n,
        interestWrittenOffMinor: 10_000n,
        feesWrittenOffMinor: 0n,
        penaltiesWrittenOffMinor: 0n,
        status: "WRITTEN_OFF",
      },
      asOf,
    );
    expect(totals.overdue).toBe(0n);
    expect(totals.outstanding).toBe(0n);
  });

  it("hides monitoring fee unless the loan has a monitoring-fee amount", () => {
    const withoutFee = [{ dueOn: new Date("2026-08-01T00:00:00.000Z"), ...baseInstallment }];
    const withFee = [
      { dueOn: new Date("2026-08-01T00:00:00.000Z"), ...baseInstallment, monitoringFeeDueMinor: 2_500n },
    ];
    expect(summarizeLoanBalance(withoutFee, { ...noWriteOff, status: "ACTIVE" }, asOf).rows.some((row) => row.key === "monitoring")).toBe(false);
    expect(summarizeLoanBalance(withFee, { ...noWriteOff, status: "ACTIVE" }, asOf).rows.some((row) => row.key === "monitoring")).toBe(true);
  });
});

describe("installmentsWithCharges", () => {
  const asOf = new Date("2026-09-19T10:00:00.000Z");
  const noWriteOff = {
    principalWrittenOffMinor: 0n,
    interestWrittenOffMinor: 0n,
    feesWrittenOffMinor: 0n,
    penaltiesWrittenOffMinor: 0n,
  };
  const installment = {
    dueOn: new Date("2026-08-01T00:00:00.000Z"),
    ...baseInstallment,
  };

  it("folds paid iLend fee charges onto an empty schedule without changing principal", () => {
    const merged = installmentsWithCharges([installment], [
      { name: "Loan Application Fee", amountMinor: 5_000_000n, status: "PAID", dueOn: null },
      { name: "Appraisal Fee", amountMinor: 10_000_000n, status: "PAID", dueOn: null },
    ]);
    expect(merged[0].feesDueMinor).toBe(15_000_000n);
    expect(merged[0].feesPaidMinor).toBe(15_000_000n);
    expect(merged[0].principalDueMinor).toBe(100_000n);
    expect(summarizeLoanBalance(merged, { ...noWriteOff, status: "ACTIVE" }, asOf).rows.find((row) => row.key === "fees")).toMatchObject({
      original: 15_000_000n,
      paid: 15_000_000n,
      outstanding: 0n,
    });
  });

  it("counts pending fee charges as outstanding", () => {
    const merged = installmentsWithCharges([installment], [
      { name: "Monthly service  & Administration fee", amountMinor: 2_000_000n, status: "PENDING", dueOn: new Date("2026-07-01T00:00:00.000Z") },
    ]);
    expect(loanOutstandingMinor(merged, noWriteOff)).toBe(2_110_000n);
    expect(merged[0].feesDueMinor).toBe(2_000_000n);
    expect(merged[0].feesPaidMinor).toBe(0n);
  });

  it("does not double-count penalties that are already on the repayment schedule", () => {
    const withPenalty = { ...installment, penaltiesDueMinor: 8_000_000n, penaltiesPaidMinor: 1_000_000n };
    const merged = installmentsWithCharges([withPenalty], [
      { name: "MICRO-LOAN Penalty", amountMinor: 8_000_000n, status: "PENDING", dueOn: installment.dueOn },
    ]);
    expect(merged[0].penaltiesDueMinor).toBe(8_000_000n);
    expect(merged[0].penaltiesPaidMinor).toBe(1_000_000n);
  });

  it("adds only the missing fee amount when charges are a superset of the schedule", () => {
    const withFees = { ...installment, feesDueMinor: 31_200_000n, feesPaidMinor: 31_200_000n };
    const merged = installmentsWithCharges([withFees], [
      { name: "Appraisal Fee", amountMinor: 31_200_000n, status: "PAID", dueOn: null },
      { name: "Passbook Fee", amountMinor: 2_500_000n, status: "PAID", dueOn: null },
    ]);
    expect(merged[0].feesDueMinor).toBe(33_700_000n);
    expect(merged[0].feesPaidMinor).toBe(33_700_000n);
  });
});

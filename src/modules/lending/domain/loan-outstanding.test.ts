import { describe, expect, it } from "vitest";

import {
  installmentDueMinor,
  installmentOutstandingMinor,
  installmentPaidMinor,
  installmentWaivedMinor,
  isLoanSettledStatus,
  loanOutstandingMinor,
  loanWrittenOffMinor,
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

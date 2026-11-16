import { describe, expect, it } from "vitest";

import { installmentsWithCharges, type LoanChargeAmounts } from "@/modules/lending/domain/loan-outstanding";

import { foldedChargesForLoan } from "./portfolio-charges";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const installments = [
  {
    dueOn: day("2026-01-01"),
    principalDueMinor: 50_000n,
    interestDueMinor: 5_000n,
    feesDueMinor: 1_000n,
    penaltiesDueMinor: 4_000n,
    principalPaidMinor: 0n,
    interestPaidMinor: 0n,
    feesPaidMinor: 0n,
    penaltiesPaidMinor: 0n,
    feesWaivedMinor: 0n,
    penaltiesWaivedMinor: 0n,
  },
  {
    dueOn: day("2026-02-01"),
    principalDueMinor: 50_000n,
    interestDueMinor: 5_000n,
    feesDueMinor: 0n,
    penaltiesDueMinor: 0n,
    principalPaidMinor: 0n,
    interestPaidMinor: 0n,
    feesPaidMinor: 0n,
    penaltiesPaidMinor: 0n,
    feesWaivedMinor: 0n,
    penaltiesWaivedMinor: 0n,
  },
];

describe("foldedChargesForLoan", () => {
  it("matches applying every repeated charge when the schedule already has that component", () => {
    const raw: LoanChargeAmounts[] = [
      { name: "MICRO-LOAN Penalty", amountMinor: 500n, status: "PENDING", dueOn: day("2026-01-01") },
      { name: "MICRO-LOAN Penalty", amountMinor: 500n, status: "PENDING", dueOn: day("2026-01-01") },
      { name: "MICRO-LOAN Penalty", amountMinor: 250n, status: "PAID", dueOn: day("2026-03-01") },
    ];
    const folded = foldedChargesForLoan(
      { feesDueMinor: 1_000n, penaltiesDueMinor: 4_000n },
      [{ penalty: true, status: "PENDING", amountMinor: 1_000n }, { penalty: true, status: "PAID", amountMinor: 250n }],
      [],
    );
    expect(installmentsWithCharges(installments, folded)).toEqual(installmentsWithCharges(installments, raw));
  });

  it("matches per-day charges when the schedule has no penalty balance", () => {
    const bare = installments.map((item) => ({ ...item, penaltiesDueMinor: 0n }));
    const raw: LoanChargeAmounts[] = [
      { name: "MICRO-LOAN Penalty", amountMinor: 700n, status: "PENDING", dueOn: day("2026-02-01") },
      { name: "MICRO-LOAN Penalty", amountMinor: 300n, status: "PENDING", dueOn: day("2026-02-01") },
      { name: "MICRO-LOAN Penalty", amountMinor: 100n, status: "PENDING", dueOn: day("2026-01-01") },
    ];
    const folded = foldedChargesForLoan(
      { feesDueMinor: 1_000n, penaltiesDueMinor: 0n },
      [],
      [
        { penalty: true, status: "PENDING", amountMinor: 1_000n, dueOn: day("2026-02-01") },
        { penalty: true, status: "PENDING", amountMinor: 100n, dueOn: day("2026-01-01") },
      ],
    );
    expect(installmentsWithCharges(bare, folded)).toEqual(installmentsWithCharges(bare, raw));
  });
});

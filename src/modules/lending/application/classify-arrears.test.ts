import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { classifyLoanArrears } from "./classify-arrears";

const installment = {
  dueOn: new Date("2026-11-03T00:00:00.000Z"),
  principalDueMinor: 4_936_700n,
  interestDueMinor: 0n,
  feesDueMinor: 0n,
  penaltiesDueMinor: 0n,
  monitoringFeeDueMinor: 0n,
  principalPaidMinor: 0n,
  interestPaidMinor: 0n,
  feesPaidMinor: 0n,
  penaltiesPaidMinor: 0n,
  monitoringFeePaidMinor: 0n,
  principalWaivedMinor: 0n,
  interestWaivedMinor: 0n,
  feesWaivedMinor: 0n,
  penaltiesWaivedMinor: 0n,
  monitoringFeeWaivedMinor: 0n,
};

describe("classifyLoanArrears", () => {
  it("does not mark a loan in arrears for an installment that is only due today", async () => {
    const transaction = vi.fn();
    const prisma = {
      loan: {
        findMany: vi.fn(async () => [{ id: "loan-1", status: "ACTIVE", installments: [installment] }]),
      },
      $transaction: transaction,
    } as unknown as PrismaClient;

    const changed = await classifyLoanArrears(prisma, new Date("2026-11-03T11:41:00.000Z"));
    expect(changed).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});

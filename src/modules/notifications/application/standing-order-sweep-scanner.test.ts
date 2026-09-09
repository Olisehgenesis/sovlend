import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import { enqueueStandingOrderSweeps } from "./standing-order-sweep-scanner";

describe("enqueueStandingOrderSweeps", () => {
  it("queues overdue installments using total due/overdue outstanding across the loan", async () => {
    const add = vi.fn(async () => ({}));
    const prisma = {
      loan: {
        findMany: vi.fn(async () => [
          {
            id: "loan-1",
            clientId: "client-1",
            accountNumber: "LN-0001",
            denominationCurrency: "UGX",
            installments: [
              {
                id: "installment-1",
                dueOn: new Date("2026-09-04T00:00:00.000Z"),
                principalDueMinor: 100_000n,
                interestDueMinor: 10_000n,
                feesDueMinor: 0n,
                monitoringFeeDueMinor: 400n,
                penaltiesDueMinor: 0n,
                principalPaidMinor: 60_000n,
                interestPaidMinor: 0n,
                feesPaidMinor: 0n,
                monitoringFeePaidMinor: 0n,
                penaltiesPaidMinor: 0n,
                principalWaivedMinor: 0n,
                interestWaivedMinor: 0n,
                feesWaivedMinor: 0n,
                monitoringFeeWaivedMinor: 0n,
                penaltiesWaivedMinor: 0n,
              },
              {
                id: "installment-2",
                dueOn: new Date("2026-09-08T00:00:00.000Z"),
                principalDueMinor: 50_000n,
                interestDueMinor: 5_000n,
                feesDueMinor: 0n,
                monitoringFeeDueMinor: 0n,
                penaltiesDueMinor: 0n,
                principalPaidMinor: 10_000n,
                interestPaidMinor: 0n,
                feesPaidMinor: 0n,
                monitoringFeePaidMinor: 0n,
                penaltiesPaidMinor: 0n,
                principalWaivedMinor: 0n,
                interestWaivedMinor: 0n,
                feesWaivedMinor: 0n,
                monitoringFeeWaivedMinor: 0n,
                penaltiesWaivedMinor: 0n,
              },
            ],
            client: {
              mobileNumber: "0700000000",
              savingsAccounts: [{ id: "savings-1", isDefault: true, currencyCode: "UGX" }],
            },
          },
          {
            id: "loan-2",
            clientId: "client-2",
            accountNumber: "LN-0002",
            denominationCurrency: "UGX",
            installments: [
              {
                id: "installment-3",
                dueOn: new Date("2026-09-03T00:00:00.000Z"),
                principalDueMinor: 30_000n,
                interestDueMinor: 3_000n,
                feesDueMinor: 0n,
                monitoringFeeDueMinor: 0n,
                penaltiesDueMinor: 0n,
                principalPaidMinor: 30_000n,
                interestPaidMinor: 3_000n,
                feesPaidMinor: 0n,
                monitoringFeePaidMinor: 0n,
                penaltiesPaidMinor: 0n,
                principalWaivedMinor: 0n,
                interestWaivedMinor: 0n,
                feesWaivedMinor: 0n,
                monitoringFeeWaivedMinor: 0n,
                penaltiesWaivedMinor: 0n,
              },
            ],
            client: {
              mobileNumber: "0711111111",
              savingsAccounts: [{ id: "savings-2", isDefault: true, currencyCode: "UGX" }],
            },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const queued = await enqueueStandingOrderSweeps(
      prisma,
      { add } as unknown as Queue,
      new Date("2026-09-09T08:00:00.000Z"),
    );

    expect(queued).toBe(1);
    expect(add).toHaveBeenCalledOnce();
    const [, payload] = add.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(payload).toMatchObject({
      requestKey: "standing-order-sweep:loan-1:daily:2026-09-09",
      installmentId: "installment-1",
      dueOn: "2026-09-04T00:00:00.000Z",
      outstandingMinor: "95400",
      savingsAccountId: "savings-1",
    });
  });

  it("falls back to the client's sole active savings account when no default is flagged", async () => {
    const add = vi.fn(async () => ({}));
    const prisma = {
      loan: {
        findMany: vi.fn(async () => [
          {
            id: "loan-3",
            clientId: "client-3",
            accountNumber: "LN-0003",
            denominationCurrency: "UGX",
            installments: [
              {
                id: "installment-4",
                dueOn: new Date("2026-09-09T00:00:00.000Z"),
                principalDueMinor: 20_000n,
                interestDueMinor: 2_000n,
                feesDueMinor: 0n,
                monitoringFeeDueMinor: 0n,
                penaltiesDueMinor: 0n,
                principalPaidMinor: 0n,
                interestPaidMinor: 0n,
                feesPaidMinor: 0n,
                monitoringFeePaidMinor: 0n,
                penaltiesPaidMinor: 0n,
                principalWaivedMinor: 0n,
                interestWaivedMinor: 0n,
                feesWaivedMinor: 0n,
                monitoringFeeWaivedMinor: 0n,
                penaltiesWaivedMinor: 0n,
              },
            ],
            client: {
              mobileNumber: null,
              savingsAccounts: [{ id: "savings-sole", isDefault: false, currencyCode: "UGX" }],
            },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const queued = await enqueueStandingOrderSweeps(
      prisma,
      { add } as unknown as Queue,
      new Date("2026-09-09T08:00:00.000Z"),
    );

    expect(queued).toBe(1);
    const [, payload] = add.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(payload.savingsAccountId).toBe("savings-sole");
  });
});

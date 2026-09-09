import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import { enqueueRepaymentReminders } from "./reminder-scanner";

describe("enqueueRepaymentReminders", () => {
  it("includes monitoring fee in both total due and extra-charges reminder amounts", async () => {
    const add = vi.fn(async () => ({}));
    const prisma = {
      loanInstallment: {
        findMany: vi.fn(async () => [
          {
            id: "installment-1",
            dueOn: new Date("2026-09-05T00:00:00.000Z"),
            principalDueMinor: 100_000n,
            interestDueMinor: 20_000n,
            feesDueMinor: 500n,
            monitoringFeeDueMinor: 400n,
            penaltiesDueMinor: 100n,
            principalPaidMinor: 10_000n,
            interestPaidMinor: 0n,
            feesPaidMinor: 0n,
            monitoringFeePaidMinor: 0n,
            penaltiesPaidMinor: 0n,
            loan: {
              id: "loan-1",
              clientId: "client-1",
              accountNumber: "LN-0001",
              denominationCurrency: "UGX",
              client: { mobileNumber: "0700000000" },
            },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const queued = await enqueueRepaymentReminders(
      prisma,
      { add } as unknown as Queue,
      new Date("2026-09-09T00:00:00.000Z"),
    );

    expect(queued).toBe(1);
    expect(add).toHaveBeenCalledOnce();
    const [, payload] = add.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(payload).toMatchObject({
      amountDueMinor: "111000",
      feesDueMinor: "1000",
      type: "REPAYMENT_OVERDUE",
    });
  });
});

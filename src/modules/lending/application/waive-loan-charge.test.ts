import { describe, expect, it, vi } from "vitest";

import { setClientChargeStatus } from "./waive-loan-charge";

describe("setClientChargeStatus", () => {
  it("marks a pending client charge waived without a refund", async () => {
    const update = vi.fn(async () => ({ id: "charge-1", status: "WAIVED" }));
    const prisma = {
      charge: {
        findFirst: vi.fn(async () => ({
          id: "charge-1",
          clientId: "client-1",
          loanId: null,
          status: "PENDING",
          name: "Admission fee",
          amountMinor: 10_000n,
          currencyCode: "UGX",
        })),
        update,
      },
    };

    await setClientChargeStatus(prisma as never, {
      clientId: "client-1",
      chargeId: "charge-1",
      actorUserId: "user-1",
      status: "WAIVED",
    });

    expect(update).toHaveBeenCalledWith({ where: { id: "charge-1" }, data: { status: "WAIVED" } });
  });

  it("uses the linked loan when a client charge was taken at disbursement", async () => {
    const prisma = {
      charge: {
        findFirst: vi.fn(async ({ where }: { where: { loanId?: string } }) => ({
          id: "charge-1",
          clientId: "client-1",
          loanId: where.loanId ?? "loan-1",
          status: "PENDING",
          name: "CRB fee",
          amountMinor: 1_000_000n,
          currencyCode: "UGX",
        })),
        update: vi.fn(async () => ({ id: "charge-1", status: "WAIVED" })),
      },
      loan: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "loan-1",
          officeId: "office-1",
          productId: "product-1",
          clientId: "client-1",
          groupId: null,
          accountNumber: "LN-1",
          office: { organizationId: "org-1" },
          client: { accountNumber: "0001" },
          group: null,
        })),
      },
    };

    await setClientChargeStatus(prisma as never, {
      clientId: "client-1",
      chargeId: "charge-1",
      actorUserId: "user-1",
      status: "WAIVED",
    });

    expect(prisma.loan.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "loan-1" },
      include: {
        office: { select: { organizationId: true } },
        client: { select: { accountNumber: true } },
        group: { select: { accountNumber: true } },
      },
    });
  });
});

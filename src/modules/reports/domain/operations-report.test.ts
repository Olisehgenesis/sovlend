import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import type { UserDataScope } from "@/modules/identity/application/data-scope";
import {
  collectionsReportCsv,
  loadCollectionsReport,
  type CollectionsReport,
} from "@/modules/reports/domain/operations-report";

const scope = {
  organizationId: "org-1",
  officeIds: null,
  officerUserId: null,
} as UserDataScope;

function lastWhere(findMany: ReturnType<typeof vi.fn>) {
  const call = findMany.mock.calls.at(-1);
  if (!call?.[0]) throw new Error("expected loanTransaction.findMany to be called");
  return (call[0] as { where: Record<string, unknown> }).where;
}

describe("loadCollectionsReport date filters", () => {
  it("applies both start and end businessDate bounds in one filter object", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = { loanTransaction: { findMany } } as unknown as PrismaClient;

    await loadCollectionsReport(prisma, scope, {
      startDate: "2026-11-09",
      endDate: "2026-11-10",
    });

    expect(findMany).toHaveBeenCalledOnce();
    expect(lastWhere(findMany).businessDate).toEqual({
      gte: new Date("2026-11-09T00:00:00.000Z"),
      lte: new Date("2026-11-10T00:00:00.000Z"),
    });
  });

  it("applies a lone start or end bound without dropping the other key", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = { loanTransaction: { findMany } } as unknown as PrismaClient;

    await loadCollectionsReport(prisma, scope, { startDate: "2026-11-09" });
    expect(lastWhere(findMany).businessDate).toEqual({
      gte: new Date("2026-11-09T00:00:00.000Z"),
    });

    await loadCollectionsReport(prisma, scope, { endDate: "2026-11-10" });
    expect(lastWhere(findMany).businessDate).toEqual({
      lte: new Date("2026-11-10T00:00:00.000Z"),
    });
  });

  it("omits businessDate when no range is requested", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = { loanTransaction: { findMany } } as unknown as PrismaClient;

    await loadCollectionsReport(prisma, scope, {});
    expect(lastWhere(findMany).businessDate).toBeUndefined();
  });
});

describe("collectionsReportCsv", () => {
  it("exports Others and totals in major UGX units matching the screen", () => {
    const report: CollectionsReport = {
      officeId: null,
      startDate: new Date("2026-11-09T00:00:00.000Z"),
      endDate: new Date("2026-11-10T00:00:00.000Z"),
      rows: [
        {
          transactionId: "tx-1",
          loanId: "loan-1",
          accountNumber: "000000001",
          borrowerName: "Test Borrower",
          borrowerType: "Client",
          officeId: "office-1",
          officeName: "Head Office",
          groupName: null,
          productName: "Group Loan",
          currencyCode: "UGX",
          principalMinor: 100_00n,
          interestMinor: 20_00n,
          feesMinor: 0n,
          penaltiesMinor: 0n,
          othersMinor: 113_770_306_949n,
          totalMinor: 113_770_307_069n,
          receiptNumber: "R-1",
          businessDate: new Date("2026-11-09T00:00:00.000Z"),
          createdAt: new Date("2026-11-09T12:00:00.000Z"),
        },
      ],
      totals: [],
    };

    const csv = collectionsReportCsv(report);
    expect(csv).toContain("Others");
    // Minor 113770306949 → major 1137703069; total 113770307069 → 1137703071
    expect(csv).toContain('"1137703069"');
    expect(csv).toContain('"1137703071"');
  });
});

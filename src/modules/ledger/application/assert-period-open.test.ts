import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertPeriodOpen, PeriodClosedError } from "./assert-period-open";

function buildPrisma(latestClosure: { closingDate: Date } | null) {
  const findFirst = vi.fn(async () => latestClosure);
  const prisma = { accountingClosure: { findFirst } } as unknown as PrismaClient;
  return { prisma, findFirst };
}

describe("assertPeriodOpen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when the office has no closure at all", async () => {
    const { prisma, findFirst } = buildPrisma(null);
    await expect(assertPeriodOpen(prisma, { officeId: "office-1", businessDate: new Date("2020-01-01T00:00:00.000Z") })).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({ where: { officeId: "office-1" }, orderBy: { closingDate: "desc" }, select: { closingDate: true } });
  });

  it("rejects a businessDate on the same day as the latest closure", async () => {
    const { prisma } = buildPrisma({ closingDate: new Date("2026-06-30T00:00:00.000Z") });
    await expect(assertPeriodOpen(prisma, { officeId: "office-1", businessDate: new Date("2026-06-30T00:00:00.000Z") })).rejects.toThrow(
      PeriodClosedError,
    );
  });

  it("rejects a businessDate before the latest closure", async () => {
    const { prisma } = buildPrisma({ closingDate: new Date("2026-06-30T00:00:00.000Z") });
    await expect(assertPeriodOpen(prisma, { officeId: "office-1", businessDate: new Date("2026-05-15T00:00:00.000Z") })).rejects.toThrow(
      "closed on or before 2026-06-30",
    );
  });

  it("allows a businessDate strictly after the latest closure", async () => {
    const { prisma } = buildPrisma({ closingDate: new Date("2026-06-30T00:00:00.000Z") });
    await expect(assertPeriodOpen(prisma, { officeId: "office-1", businessDate: new Date("2026-07-01T00:00:00.000Z") })).resolves.toBeUndefined();
  });

  it("compares by calendar date, ignoring time-of-day on businessDate", async () => {
    const { prisma } = buildPrisma({ closingDate: new Date("2026-06-30T00:00:00.000Z") });
    await expect(assertPeriodOpen(prisma, { officeId: "office-1", businessDate: new Date("2026-07-01T23:59:59.000Z") })).resolves.toBeUndefined();
    await expect(assertPeriodOpen(prisma, { officeId: "office-1", businessDate: new Date("2026-06-30T23:59:59.000Z") })).rejects.toThrow(
      PeriodClosedError,
    );
  });
});

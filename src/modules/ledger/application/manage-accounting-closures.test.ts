import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAccountingClosure } from "./manage-accounting-closures";

function buildPrisma(overrides: { office?: unknown; latestClosure?: unknown } = {}) {
  const closureCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "closure-1", ...args.data }));
  const auditEventCreate = vi.fn(async () => ({}));
  const outboxEventCreate = vi.fn(async () => ({}));

  const tx = {
    accountingClosure: { create: closureCreate },
    auditEvent: { create: auditEventCreate },
    outboxEvent: { create: outboxEventCreate },
  };

  const prisma = {
    office: { findFirst: vi.fn(async () => ("office" in overrides ? overrides.office : { id: "office-1", organizationId: "org-1" })) },
    accountingClosure: { findFirst: vi.fn(async () => overrides.latestClosure ?? null) },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;

  return { prisma, closureCreate, auditEventCreate, outboxEventCreate };
}

const baseCommand = {
  organizationId: "org-1",
  officeId: "office-1",
  actorUserId: "user-1",
  closingDate: new Date("2026-06-30T00:00:00.000Z"),
  comment: "June close",
};

describe("createAccountingClosure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the first closure for an office with no prior closure", async () => {
    const { prisma, closureCreate, auditEventCreate, outboxEventCreate } = buildPrisma();
    const closure = await createAccountingClosure(prisma, baseCommand);

    expect(closureCreate).toHaveBeenCalledWith({
      data: { organizationId: "org-1", officeId: "office-1", closingDate: baseCommand.closingDate, comment: "June close", createdByUserId: "user-1" },
    });
    expect(auditEventCreate).toHaveBeenCalled();
    expect(outboxEventCreate).toHaveBeenCalled();
    expect(closure).toMatchObject({ id: "closure-1" });
  });

  it("allows a closing date strictly after the current latest closure", async () => {
    const { prisma, closureCreate } = buildPrisma({ latestClosure: { closingDate: new Date("2026-05-31T00:00:00.000Z") } });
    await createAccountingClosure(prisma, baseCommand);
    expect(closureCreate).toHaveBeenCalled();
  });

  it("rejects a closing date on the same day as the current latest closure", async () => {
    const { prisma } = buildPrisma({ latestClosure: { closingDate: new Date("2026-06-30T00:00:00.000Z") } });
    await expect(createAccountingClosure(prisma, baseCommand)).rejects.toThrow("must be after the current closing date");
  });

  it("rejects a closing date before the current latest closure", async () => {
    const { prisma } = buildPrisma({ latestClosure: { closingDate: new Date("2026-07-31T00:00:00.000Z") } });
    await expect(createAccountingClosure(prisma, baseCommand)).rejects.toThrow("2026-07-31");
  });

  it("rejects when the office does not belong to the organization", async () => {
    const { prisma } = buildPrisma({ office: null });
    await expect(createAccountingClosure(prisma, baseCommand)).rejects.toThrow("Office not found");
  });

  it("stores a null comment when none is provided", async () => {
    const { prisma, closureCreate } = buildPrisma();
    await createAccountingClosure(prisma, { ...baseCommand, comment: null });
    expect(closureCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ comment: null }) }));
  });
});

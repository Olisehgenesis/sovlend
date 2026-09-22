import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { grantJumpStartAfricaAccess } from "./grant-flagship-access";

describe("grantJumpStartAfricaAccess", () => {
  it("creates ACTIVE access when the investor has none yet", async () => {
    const created: unknown[] = [];
    const prisma = {
      organization: { findFirst: async () => ({ id: "org-1" }) },
      investorOrganizationAccess: {
        findUnique: async () => null,
        create: async (args: { data: unknown }) => {
          created.push(args.data);
          return args.data;
        },
        update: async () => {
          throw new Error("should not update");
        },
      },
    } as unknown as PrismaClient;

    await grantJumpStartAfricaAccess(prisma, "investor-1");
    expect(created).toEqual([
      expect.objectContaining({ investorId: "investor-1", organizationId: "org-1", status: "ACTIVE" }),
    ]);
  });

  it("promotes a leftover REQUESTED row to ACTIVE instead of leaving the investor locked out", async () => {
    const updates: unknown[] = [];
    const prisma = {
      organization: { findFirst: async () => ({ id: "org-1" }) },
      investorOrganizationAccess: {
        findUnique: async () => ({ id: "access-1", status: "REQUESTED" }),
        create: async () => {
          throw new Error("should not create");
        },
        update: async (args: { data: unknown }) => {
          updates.push(args.data);
          return args.data;
        },
      },
    } as unknown as PrismaClient;

    await grantJumpStartAfricaAccess(prisma, "investor-1");
    expect(updates).toEqual([expect.objectContaining({ status: "ACTIVE" })]);
  });

  it("does not reopen REJECTED flagship access", async () => {
    const prisma = {
      organization: { findFirst: async () => ({ id: "org-1" }) },
      investorOrganizationAccess: {
        findUnique: async () => ({ id: "access-1", status: "REJECTED" }),
        create: async () => {
          throw new Error("should not create");
        },
        update: async () => {
          throw new Error("should not update");
        },
      },
    } as unknown as PrismaClient;

    await grantJumpStartAfricaAccess(prisma, "investor-1");
  });
});

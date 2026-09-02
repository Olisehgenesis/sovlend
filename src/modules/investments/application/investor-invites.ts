import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createInvestorInvite(
  prisma: PrismaClient,
  input: { organizationId: string; email: string; createdById: string },
) {
  const token = randomBytes(32).toString("base64url");
  const invite = await prisma.investorInvite.create({
    data: {
      organizationId: input.organizationId,
      email: input.email.toLowerCase(),
      tokenHash: hashInviteToken(token),
      createdById: input.createdById,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1_000),
    },
  });
  return { invite, token };
}
import type { PrismaClient } from "@prisma/client";

import { ensureInvestorWorkspace } from "./ensure-investor-workspace";
import { createInvestorInvite } from "./investor-invites";

export async function approveInvestorLead(
  prisma: PrismaClient,
  input: { leadId: string; createdById: string },
) {
  const lead = await prisma.investorAccessRequest.findUnique({ where: { id: input.leadId } });
  if (!lead || lead.status !== "REQUESTED") {
    throw new Error("Access request is not pending");
  }

  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: lead.email, mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });

  if (existingUser) {
    const investor = await ensureInvestorWorkspace(prisma, existingUser);
    await prisma.investorOrganizationAccess.upsert({
      where: { investorId_organizationId: { investorId: investor.id, organizationId: lead.organizationId } },
      create: {
        investorId: investor.id,
        organizationId: lead.organizationId,
        status: "ACTIVE",
        approvedAt: new Date(),
      },
      update: { status: "ACTIVE", approvedAt: new Date() },
    });
    await prisma.investorAccessRequest.update({ where: { id: lead.id }, data: { status: "ACTIVE" } });
    return { kind: "granted" as const, email: lead.email };
  }

  const { invite, token } = await createInvestorInvite(prisma, {
    organizationId: lead.organizationId,
    email: lead.email,
    createdById: input.createdById,
  });
  await prisma.investorAccessRequest.update({ where: { id: lead.id }, data: { status: "INVITED" } });
  return { kind: "invited" as const, email: lead.email, inviteId: invite.id, token };
}

export async function rejectInvestorLead(prisma: PrismaClient, leadId: string) {
  const lead = await prisma.investorAccessRequest.findUnique({ where: { id: leadId } });
  if (!lead || lead.status !== "REQUESTED") {
    throw new Error("Access request is not pending");
  }
  await prisma.investorAccessRequest.update({ where: { id: lead.id }, data: { status: "REJECTED" } });
  return { kind: "rejected" as const, email: lead.email };
}

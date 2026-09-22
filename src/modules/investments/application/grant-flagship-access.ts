import type { PrismaClient } from "@prisma/client";

/**
 * Grants an investor immediate, no-approval access to fund Jump Start Africa -- SovLend's one
 * flagship business today. Any *other* business still goes through the reviewed
 * InvestorOrganizationAccess request flow (see /api/investor/access); this is specific to Jump
 * Start Africa by name, not a blanket "every business is open" policy, so adding a second
 * business later does not silently expose it to every investor.
 *
 * Idempotent -- safe to call for an investor who already has access (e.g. a self-heal path
 * re-running for an existing profile). REQUESTED/INVITED rows are promoted to ACTIVE; REJECTED
 * and SUSPENDED stays are left alone so an explicit denial is not silently undone.
 */
export async function grantJumpStartAfricaAccess(prisma: PrismaClient, investorId: string) {
  const organization = await prisma.organization.findFirst({
    where: { name: { equals: "Jump Start Africa", mode: "insensitive" } },
    select: { id: true },
  });
  if (!organization) return;
  const existing = await prisma.investorOrganizationAccess.findUnique({
    where: { investorId_organizationId: { investorId, organizationId: organization.id } },
  });
  if (!existing) {
    await prisma.investorOrganizationAccess.create({
      data: { investorId, organizationId: organization.id, status: "ACTIVE", approvedAt: new Date() },
    });
    return;
  }
  if (existing.status === "REQUESTED" || existing.status === "INVITED") {
    await prisma.investorOrganizationAccess.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", approvedAt: new Date() },
    });
  }
}

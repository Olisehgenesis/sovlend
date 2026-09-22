import type { PrismaClient } from "@prisma/client";

import { grantJumpStartAfricaAccess } from "./grant-flagship-access";

/**
 * Makes sure a signed-in user can actually open the investor board. Production had accounts
 * with systemRole INVESTOR and no InvestorProfile -- /investor then dumped them onto the
 * public lead form at /investor/request-access, which does not create a profile, so they
 * looped forever even after "requesting access".
 *
 * Also honours any leftover public-form leads for this email: flagship (Jump Start Africa)
 * leads are auto-granted, matching sign-up policy; other businesses stay REQUESTED so staff
 * can approve them from /backoffice/investors.
 */
export async function ensureInvestorWorkspace(
  prisma: PrismaClient,
  user: { id: string; name: string; email: string },
) {
  const investor = await prisma.investorProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, displayName: user.name },
  });
  await grantJumpStartAfricaAccess(prisma, investor.id);

  const flagship = await prisma.organization.findFirst({
    where: { name: { equals: "Jump Start Africa", mode: "insensitive" } },
    select: { id: true },
  });
  const leads = await prisma.investorAccessRequest.findMany({
    where: { email: { equals: user.email, mode: "insensitive" }, status: "REQUESTED" },
  });
  for (const lead of leads) {
    const isFlagship = Boolean(flagship && lead.organizationId === flagship.id);
    await prisma.investorOrganizationAccess.upsert({
      where: { investorId_organizationId: { investorId: investor.id, organizationId: lead.organizationId } },
      create: {
        investorId: investor.id,
        organizationId: lead.organizationId,
        status: isFlagship ? "ACTIVE" : "REQUESTED",
        approvedAt: isFlagship ? new Date() : null,
      },
      update: isFlagship ? { status: "ACTIVE", approvedAt: new Date() } : {},
    });
    await prisma.investorAccessRequest.update({
      where: { id: lead.id },
      data: { status: isFlagship ? "ACTIVE" : "INVITED" },
    });
  }

  return investor;
}

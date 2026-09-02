import { notFound } from "next/navigation";

import { InvestorJoinForm } from "@/components/investor-join-form";
import { prisma } from "@/lib/prisma";
import { hashInviteToken } from "@/modules/investments/application/investor-invites";

export const dynamic = "force-dynamic";

export default async function InvestorJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.investorInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { organization: { select: { name: true } } },
  });
  if (!invite || invite.status !== "INVITED" || invite.expiresAt <= new Date()) notFound();
  return <InvestorJoinForm token={token} email={invite.email} organizationName={invite.organization.name} />;
}
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { InvestorBoard } from "@/components/investor-board";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatMinor } from "@/modules/reporting/application/dashboard";

export default async function InvestorPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const investor = await prisma.investorProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      accesses: { where: { status: "ACTIVE" }, include: { organization: { select: { name: true } } } },
      commitments: { include: { organization: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!investor) redirect("/investor/request-access");

  return <InvestorBoard investorName={investor.displayName} accesses={investor.accesses.map((access) => ({ id: access.id, organizationId: access.organizationId, organizationName: access.organization.name }))} commitments={investor.commitments.map((item) => ({ id: item.id, organizationName: item.organization.name, amount: formatMinor(item.contributionAmountMinor, item.contributionCurrency), sats: item.amountSats.toLocaleString(), status: item.status, createdAt: item.createdAt.toISOString() }))} />;
}
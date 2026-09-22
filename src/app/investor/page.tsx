import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { InvestorBoard } from "@/components/investor-board";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadInvestorBtcExposure } from "@/modules/btc/application/load-investor-btc-exposure";
import { ensureInvestorWorkspace } from "@/modules/investments/application/ensure-investor-workspace";
import { loadInvestorPortfolioSummary } from "@/modules/investments/application/load-investor-portfolio-summary";
import { formatMinor } from "@/modules/reporting/application/dashboard";

const investorInclude = {
  accesses: { include: { organization: { select: { name: true as const } } } },
  commitments: { include: { organization: { select: { name: true as const } } }, orderBy: { createdAt: "desc" as const }, take: 100 },
};

export default async function InvestorPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/investor/sign-in");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true },
  });
  if (!user) redirect("/investor/sign-in");

  await ensureInvestorWorkspace(prisma, user);
  const investor = await prisma.investorProfile.findUnique({
    where: { userId: user.id },
    include: investorInclude,
  });
  if (!investor) redirect("/investor/sign-in");

  const activeAccesses = investor.accesses.filter((access) => access.status === "ACTIVE");
  const pendingAccesses = investor.accesses.filter((access) => access.status === "REQUESTED" || access.status === "INVITED");
  const requestedOrganizationIds = new Set(investor.accesses.map((access) => access.organizationId));
  const requestableOrganizations = await prisma.organization.findMany({
    where: { id: { notIn: [...requestedOrganizationIds] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const btcExposure = await loadInvestorBtcExposure(prisma, investor.id);
  const portfolio = await loadInvestorPortfolioSummary(prisma, investor.id);

  return (
    <InvestorBoard
      investorName={investor.displayName}
      accesses={activeAccesses.map((access) => ({ id: access.id, organizationId: access.organizationId, organizationName: access.organization.name }))}
      pendingAccesses={pendingAccesses.map((access) => ({ id: access.id, organizationId: access.organizationId, organizationName: access.organization.name, status: access.status, createdAt: access.createdAt.toISOString() }))}
      requestableOrganizations={requestableOrganizations}
      commitments={investor.commitments.map((item) => ({ id: item.id, organizationName: item.organization.name, amount: formatMinor(item.contributionAmountMinor, item.contributionCurrency), sats: item.amountSats.toLocaleString(), status: item.status, createdAt: item.createdAt.toISOString() }))}
      btcExposure={btcExposure.map((item) => ({
        organizationId: item.organizationId,
        organizationName: item.organizationName,
        clientBtcSats: item.clientBtcSats.toString(),
        investorFundedSats: item.investorFundedSats.toString(),
        totalBtcSats: item.totalBtcSats.toString(),
        totalBtcValueFormatted: item.totalBtcUgxMinor === null ? null : formatMinor(item.totalBtcUgxMinor, "UGX"),
        fiatPortfolioFormatted: formatMinor(item.fiatPortfolioMinor, "UGX"),
        fundsUnderManagementFormatted: formatMinor(item.fundsUnderManagementMinor, "UGX"),
        btcExposurePercent: (item.btcExposureBps / 100).toFixed(1),
      }))}
      portfolio={{
        memberSince: portfolio.memberSince.toISOString(),
        businessCount: portfolio.businessCount,
        fundedCount: portfolio.fundedCount,
        fundedSats: portfolio.fundedSats.toString(),
        pendingCount: portfolio.pendingCount,
        pendingSats: portfolio.pendingSats.toString(),
        fundedByCurrency: portfolio.fundedByCurrency.map((entry) => ({ currencyCode: entry.currencyCode, formatted: formatMinor(entry.amountMinor, entry.currencyCode) })),
        timeline: portfolio.timeline.map((point) => ({ date: point.date, cumulativeSats: Number(point.cumulativeSats) })),
      }}
    />
  );
}
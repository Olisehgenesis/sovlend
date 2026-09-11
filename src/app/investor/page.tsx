import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { InvestorBoard } from "@/components/investor-board";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadInvestorBtcExposure } from "@/modules/btc/application/load-investor-btc-exposure";
import { loadInvestorPortfolioSummary } from "@/modules/investments/application/load-investor-portfolio-summary";
import { formatMinor } from "@/modules/reporting/application/dashboard";

export default async function InvestorPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/investor/sign-in");
  const investor = await prisma.investorProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      accesses: { include: { organization: { select: { name: true } } } },
      commitments: { include: { organization: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!investor) redirect("/investor/request-access");

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
        fundedSats: portfolio.fundedSats.toLocaleString(),
        pendingCount: portfolio.pendingCount,
        pendingSats: portfolio.pendingSats.toLocaleString(),
        fundedByCurrency: portfolio.fundedByCurrency.map((entry) => ({ currencyCode: entry.currencyCode, formatted: formatMinor(entry.amountMinor, entry.currencyCode) })),
        timeline: portfolio.timeline.map((point) => ({ date: point.date, cumulativeSats: Number(point.cumulativeSats) })),
      }}
    />
  );
}
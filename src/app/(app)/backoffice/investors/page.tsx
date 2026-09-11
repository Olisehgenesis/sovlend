import Link from "next/link";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { InvestorAccessReviewList } from "@/components/investor-access-review-list";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

export const dynamic = "force-dynamic";

export default async function InvestorsBackofficePage() {
  await requireSuperAdmin();

  const pending = await prisma.investorOrganizationAccess.findMany({
    where: { status: "REQUESTED" },
    include: { investor: { select: { displayName: true, kycStatus: true } }, organization: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Backoffice", href: "/backoffice" },
          { label: "Investors" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Investor onboarding</p>
          <h1>Pending business access</h1>
          <p>Investors sign up instantly but stay locked out of business data until you approve which business they can see and fund.</p>
        </div>
      </header>
      <InvestorAccessReviewList
        requests={pending.map((item) => ({
          id: item.id,
          investorName: item.investor.displayName,
          kycStatus: item.investor.kycStatus,
          organizationName: item.organization.name,
          createdAt: item.createdAt.toISOString(),
        }))}
      />
      <p><Link href="/backoffice">Back to backoffice</Link></p>
    </main>
  );
}

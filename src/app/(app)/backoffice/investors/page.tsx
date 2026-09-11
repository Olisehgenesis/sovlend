import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { InvestorAccessReviewList } from "@/components/investor-access-review-list";
import { auth } from "@/lib/auth";
import { loadInvestorAccessScope } from "@/lib/can-manage-investor-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function InvestorsBackofficePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await loadInvestorAccessScope(session);
  if (!scope) redirect("/");

  const pending = await prisma.investorOrganizationAccess.findMany({
    where: { status: "REQUESTED", ...(scope.isSuperAdmin ? {} : { organizationId: scope.organizationId }) },
    include: { investor: { select: { displayName: true, kycStatus: true } }, organization: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={
          scope.isSuperAdmin
            ? [{ label: "Backoffice", href: "/backoffice" }, { label: "Investors" }]
            : [{ label: "Investors" }]
        }
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
      {scope.isSuperAdmin ? <p><Link href="/backoffice">Back to backoffice</Link></p> : null}
    </main>
  );
}

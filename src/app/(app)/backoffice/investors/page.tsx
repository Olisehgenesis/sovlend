import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { InvestorAccessReviewList } from "@/components/investor-access-review-list";
import { InvestorLeadReviewList } from "@/components/investor-lead-review-list";
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

  // Separate from the in-app request flow above: this is the pre-account "request an account"
  // lead form at /investor/request-access, which anyone can submit without signing up first.
  // It used to write here and nothing ever displayed it -- surfacing it so a submitted lead is
  // never silently lost.
  const leads = await prisma.investorAccessRequest.findMany({
    where: { status: "REQUESTED", ...(scope.isSuperAdmin ? {} : { organizationId: scope.organizationId }) },
    include: { organization: { select: { name: true } } },
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
          <p>Branch managers and general managers can approve requests for this business. Jump Start Africa is granted on sign-up; other businesses still need a review here.</p>
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
      <InvestorLeadReviewList
        leads={leads.map((lead) => ({
          id: lead.id,
          name: lead.name,
          email: lead.email,
          organizationName: lead.organization.name,
          message: lead.message,
          createdAt: lead.createdAt.toISOString(),
        }))}
      />
      {scope.isSuperAdmin ? <p><Link href="/backoffice">Back to backoffice</Link></p> : null}
    </main>
  );
}

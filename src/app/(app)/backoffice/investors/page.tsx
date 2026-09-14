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
      {leads.length > 0 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Inbound investor leads</h2>
              <p>Submitted before creating an account, via the public &ldquo;request an account&rdquo; form -- reach out directly and point them to sign up.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Business</th>
                  <th>Message</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td><strong>{lead.name}</strong></td>
                    <td>{lead.email}</td>
                    <td>{lead.organization.name}</td>
                    <td>{lead.message ?? <span className="muted-text">—</span>}</td>
                    <td>{new Date(lead.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {scope.isSuperAdmin ? <p><Link href="/backoffice">Back to backoffice</Link></p> : null}
    </main>
  );
}

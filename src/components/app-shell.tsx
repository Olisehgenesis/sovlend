import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppHeader } from "./app-header";
import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { canPostLedger } from "@/lib/can-post-ledger";
import { loadInvestorAccessScope } from "@/lib/can-manage-investor-access";
import { prisma } from "@/lib/prisma";
import { loadVisibleReportSections } from "@/modules/reports/report-catalog";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { systemRole: true, organizationId: true, mustChangePassword: true, organization: { select: { name: true } }, office: { select: { name: true } } },
  });
  if (user?.systemRole === "CLIENT") redirect("/portal");
  if (user?.mustChangePassword) redirect("/change-password");
  const admin = session.user.role === "admin";
  const { allowed: products } = admin ? { allowed: true } : await canManageProducts(session);
  const ledgerPost = admin ? true : await canPostLedger(session);
  const investorAccessScope = await loadInvestorAccessScope(session);
  const canManageInvestors = investorAccessScope !== null;
  const visibleReportSections = user?.organizationId
    ? await loadVisibleReportSections(prisma, session.user.id, user.organizationId)
    : [];
  // Strip the LucideIcon component refs before crossing into client components — functions
  // cannot be serialized across the RSC boundary, only the plain nav data is needed here.
  const reportSections = visibleReportSections
    .filter((section) => section.reports.length > 0)
    .map((section) => ({
      id: section.id,
      title: section.title,
      reports: section.reports.map((report) => ({ href: report.href, title: report.title })),
    }));

  return (
    <div className="app-shell">
      <AppHeader admin={admin} canManageProducts={products} canPostLedger={ledgerPost} canManageInvestors={canManageInvestors} officeName={user?.office?.name} reportSections={reportSections} workspaceName={user?.organization?.name} />
      <div className="app-main">{children}</div>
    </div>
  );
}

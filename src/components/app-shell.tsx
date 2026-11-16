import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppHeader } from "./app-header";
import { NavigationProgress } from "./navigation-progress";
import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { canPostLedger } from "@/lib/can-post-ledger";
import { loadInvestorAccessScope } from "@/lib/can-manage-investor-access";
import { loadAccessUser } from "@/modules/identity/application/actor-access";
import { prisma } from "@/lib/prisma";
import { loadVisibleReportSections } from "@/modules/reports/report-catalog";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const user = await loadAccessUser(session.user.id);
  if (user?.systemRole === "CLIENT") redirect("/portal");
  if (user?.mustChangePassword) redirect("/change-password");

  return (
    <div className="app-shell">
      <Suspense
        fallback={
          <AppHeader
            admin={session.user.role === "admin"}
            officeName={user?.office?.name}
            workspaceName={user?.organization?.name}
          />
        }
      >
        <ShellNavigation
          admin={session.user.role === "admin"}
          officeName={user?.office?.name}
          organizationId={user?.organizationId ?? null}
          session={session}
          workspaceName={user?.organization?.name}
        />
      </Suspense>
      <div className="app-main">
        <NavigationProgress>{children}</NavigationProgress>
      </div>
    </div>
  );
}

async function ShellNavigation({
  admin,
  officeName,
  organizationId,
  session,
  workspaceName,
}: {
  admin: boolean;
  officeName?: string | null;
  organizationId: string | null;
  session: { user: { id: string; role?: string | null } };
  workspaceName?: string | null;
}) {
  const [{ allowed: products }, ledgerPost, investorAccessScope, visibleReportSections] = await Promise.all([
    admin ? Promise.resolve({ allowed: true }) : canManageProducts(session),
    admin ? Promise.resolve(true) : canPostLedger(session),
    loadInvestorAccessScope(session),
    organizationId ? loadVisibleReportSections(prisma, session.user.id, organizationId) : Promise.resolve([]),
  ]);

  const reportSections = visibleReportSections
    .filter((section) => section.reports.length > 0)
    .map((section) => ({
      id: section.id,
      title: section.title,
      reports: section.reports.map((report) => ({ href: report.href, title: report.title })),
    }));

  return (
    <AppHeader
      admin={admin}
      canManageInvestors={investorAccessScope !== null}
      canManageProducts={products}
      canPostLedger={ledgerPost}
      officeName={officeName}
      reportSections={reportSections}
      workspaceName={workspaceName}
    />
  );
}

import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { PostProvisioningEntryForm } from "@/components/post-provisioning-entry-form";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export default async function ProvisioningEntriesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, scope.organizationId, permissions.ledgerPost);
  if (!allowed) redirect("/reports/risk/provisioning");

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { officeId: true } });
  const [offices, defaults] = await Promise.all([
    prisma.office.findMany({
      where: { organizationId: scope.organizationId, ...(scope.officeIds ? { id: { in: [...scope.officeIds] } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.provisioningAccountingDefaults.findUnique({ where: { organizationId: scope.organizationId } }),
  ]);

  const defaultsConfigured = Boolean(defaults?.provisionExpenseAccountId && defaults?.loanLossProvisionAccountId);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Accounting", href: "/backoffice/accounting" }, { label: "Provisioning entries" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting</p>
          <h1>Provisioning entries</h1>
          <p>Post the change in required loan-loss provision, computed from portfolio-at-risk aging, as a balanced journal entry.</p>
        </div>
        <Link className="secondary-action" href="/reports/risk/provisioning">
          Provisioning report
        </Link>
      </header>
      <section className="panel form-panel">
        <PostProvisioningEntryForm officeId={user?.officeId ?? null} offices={offices} defaultsConfigured={defaultsConfigured} />
      </section>
    </main>
  );
}

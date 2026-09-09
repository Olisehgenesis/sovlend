import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { ManualJournalEntryForm } from "@/components/manual-journal-entry-form";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export default async function RecordExpensePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, scope.organizationId, permissions.ledgerPost);
  if (!allowed) redirect("/reports/accounting/chart-of-accounts");

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { officeId: true } });
  const [offices, ledgerAccounts, settlementAccounts] = await Promise.all([
    prisma.office.findMany({ where: { organizationId: scope.organizationId, ...(scope.officeIds ? { id: { in: [...scope.officeIds] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.ledgerAccount.findMany({ where: { active: true, usage: "DETAIL", type: "EXPENSE", manualEntriesAllowed: true }, select: { id: true, code: true, name: true }, orderBy: [{ code: "asc" }] }),
    prisma.settlementAccount.findMany({ where: { organizationId: scope.organizationId, active: true }, select: { id: true, name: true, type: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Accounting", href: "/backoffice/accounting" }, { label: "Record expense" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting</p>
          <h1>Record expense</h1>
          <p>Post a manual expense entry -- e.g. rent, utilities, or salaries -- paid from cash, bank, or mobile money.</p>
        </div>
        <Link className="secondary-action" href="/backoffice/accounting">
          Accounting mappings
        </Link>
      </header>
      <section className="panel form-panel">
        <ManualJournalEntryForm entryType="EXPENSE" officeId={user?.officeId ?? null} offices={offices} ledgerAccounts={ledgerAccounts} settlementAccounts={settlementAccounts} />
      </section>
    </main>
  );
}

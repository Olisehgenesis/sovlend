import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { GeneralJournalEntryForm } from "@/components/general-journal-entry-form";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export default async function AddJournalEntriesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, scope.organizationId, permissions.ledgerPost);
  if (!allowed) redirect("/reports/accounting/journal-reconciliation");

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { officeId: true } });
  const [offices, currencies, ledgerAccounts] = await Promise.all([
    prisma.office.findMany({ where: { organizationId: scope.organizationId, ...(scope.officeIds ? { id: { in: [...scope.officeIds] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.currency.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.ledgerAccount.findMany({
      where: { active: true, usage: "DETAIL", manualEntriesAllowed: true },
      select: { id: true, code: true, name: true, type: true, currencyCode: true },
      orderBy: [{ code: "asc" }],
    }),
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Accounting", href: "/backoffice/accounting" }, { label: "Add journal entries" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting</p>
          <h1>Add journal entries</h1>
          <p>Post a free-form, balanced journal entry across any GL accounts -- for corrections, transfers, and postings that don&apos;t fit Record income/expense.</p>
        </div>
        <Link className="secondary-action" href="/reports/accounting/journal-reconciliation">
          Search journal entries
        </Link>
      </header>
      <section className="panel form-panel">
        <GeneralJournalEntryForm officeId={user?.officeId ?? null} offices={offices} currencies={currencies} ledgerAccounts={ledgerAccounts} />
      </section>
    </main>
  );
}

import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { FrequentPostingForm } from "@/components/frequent-posting-form";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export default async function FrequentPostingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(session.user.id, scope.organizationId, permissions.ledgerPost);
  if (!allowed) redirect("/reports/accounting/chart-of-accounts");

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { officeId: true } });
  const [offices, rules] = await Promise.all([
    prisma.office.findMany({
      where: { organizationId: scope.organizationId, ...(scope.officeIds ? { id: { in: [...scope.officeIds] } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.accountingRule.findMany({
      where: { organizationId: scope.organizationId, active: true },
      include: { accounts: { include: { account: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const ruleOptions = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    officeId: rule.officeId,
    debitAccounts: rule.accounts.filter((entry) => entry.side === "DEBIT").map((entry) => ({ id: entry.account.id, code: entry.account.code, name: entry.account.name })),
    creditAccounts: rule.accounts.filter((entry) => entry.side === "CREDIT").map((entry) => ({ id: entry.account.id, code: entry.account.code, name: entry.account.name })),
  }));

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Accounting", href: "/backoffice/accounting" }, { label: "Frequent postings" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting</p>
          <h1>Frequent postings</h1>
          <p>Pick a predefined accounting rule, enter an amount, and post -- no need to choose raw debit/credit accounts each time.</p>
        </div>
        <Link className="secondary-action" href="/backoffice/accounting">
          Accounting mappings
        </Link>
      </header>
      <section className="panel form-panel">
        <FrequentPostingForm officeId={user?.officeId ?? null} offices={offices} rules={ruleOptions} />
      </section>
    </main>
  );
}

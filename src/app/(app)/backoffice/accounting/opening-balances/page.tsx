import Link from "next/link";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { OpeningBalanceMigrationForm } from "@/components/opening-balance-migration-form";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

export default async function OpeningBalanceMigrationsPage() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { organizationId: true, officeId: true } });
  if (!user.organizationId) throw new Error("Super administrator requires an organization");

  const [offices, accounts, defaults] = await Promise.all([
    prisma.office.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.ledgerAccount.findMany({
      where: { currencyCode: "UGX", active: true, usage: "DETAIL" },
      select: { id: true, code: true, name: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    }),
    prisma.openingBalanceAccountingDefaults.findUnique({ where: { organizationId: user.organizationId } }),
  ]);

  const defaultsConfigured = Boolean(defaults?.openingBalanceEquityAccountId);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Accounting", href: "/backoffice/accounting" }, { label: "Migrate opening balances" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Accounting</p>
          <h1>Migrate opening balances</h1>
          <p>Set a GL account&apos;s starting balance at a specific office as of a date, one time per office and account.</p>
        </div>
        <Link className="secondary-action" href="/backoffice/accounting">
          Accounting mappings
        </Link>
      </header>
      <section className="panel form-panel">
        <OpeningBalanceMigrationForm officeId={user.officeId ?? null} offices={offices} accounts={accounts} defaultsConfigured={defaultsConfigured} />
      </section>
    </main>
  );
}

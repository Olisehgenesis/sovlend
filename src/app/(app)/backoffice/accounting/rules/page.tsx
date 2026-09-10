import Link from "next/link";

import { AccountingRulesManager } from "@/components/accounting-rules-manager";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

export default async function AccountingRulesPage() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user.organizationId) throw new Error("Super administrator requires an organization");

  const [rules, offices, accounts] = await Promise.all([
    prisma.accountingRule.findMany({
      where: { organizationId: user.organizationId },
      include: { accounts: true },
      orderBy: { name: "asc" },
    }),
    prisma.office.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.ledgerAccount.findMany({
      where: { active: true, usage: "DETAIL", manualEntriesAllowed: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    }),
  ]);

  const ruleSummaries = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    active: rule.active,
    officeId: rule.officeId,
    debitAccountIds: rule.accounts.filter((account) => account.side === "DEBIT").map((account) => account.accountId),
    creditAccountIds: rule.accounts.filter((account) => account.side === "CREDIT").map((account) => account.accountId),
  }));

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Accounting", href: "/backoffice/accounting" }, { label: "Accounting rules" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Financial controls</p>
          <h1>Accounting rules</h1>
          <p>Predefined debit/credit templates -- e.g. &quot;Petty Cash Replenishment&quot; -- that a Frequent posting can use instead of picking raw accounts every time.</p>
        </div>
        <Link className="secondary-action" href="/backoffice/accounting">
          Accounting mappings
        </Link>
      </header>
      <section className="panel">
        <AccountingRulesManager rules={ruleSummaries} offices={offices} accounts={accounts} />
      </section>
    </main>
  );
}

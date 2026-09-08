import Link from "next/link";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { FundManagementForm } from "@/components/fund-management-form";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

export default async function FundsBackofficePage() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { organizationId: true },
  });
  if (!user.organizationId) throw new Error("Super administrator requires an organization");

  const [funds, ledgerAccounts] = await Promise.all([
    prisma.fund.findMany({
      where: { organizationId: user.organizationId },
      include: { ledgerAccount: { select: { id: true, code: true, name: true, type: true, currencyCode: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.ledgerAccount.findMany({
      where: { active: true, usage: "DETAIL" },
      select: { id: true, code: true, name: true, type: true, currencyCode: true },
      orderBy: [{ type: "asc" }, { currencyCode: "asc" }, { code: "asc" }],
    }),
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs
        items={[
          { label: "Backoffice", href: "/backoffice" },
          { label: "Funds" },
        ]}
      />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Funding controls</p>
          <h1>Manage Funds</h1>
          <p>Configure reporting funds and optionally attach each one to a real detail ledger account.</p>
        </div>
        <Link className="secondary-action" href="/backoffice">
          Backoffice
        </Link>
      </header>
      <section className="panel">
        <FundManagementForm
          funds={funds}
          ledgerAccounts={ledgerAccounts.map((account) => ({
            id: account.id,
            label: `${account.code} · ${account.name} · ${account.type} · ${account.currencyCode}`,
          }))}
          organizationId={user.organizationId}
        />
      </section>
    </main>
  );
}

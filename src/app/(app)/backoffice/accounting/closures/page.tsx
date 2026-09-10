import Link from "next/link";

import { AccountingClosureForm } from "@/components/accounting-closure-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

export default async function AccountingClosuresPage() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user.organizationId) throw new Error("Super administrator requires an organization");

  const [offices, closures] = await Promise.all([
    prisma.office.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.accountingClosure.findMany({
      where: { organizationId: user.organizationId },
      include: { office: { select: { name: true } }, createdByUser: { select: { name: true, email: true } } },
      orderBy: { closingDate: "desc" },
    }),
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Accounting", href: "/backoffice/accounting" }, { label: "Closing entries" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Financial controls</p>
          <h1>Closing entries</h1>
          <p>Period-end locks: once an office is closed as of a date, no new journal entry can be posted on or before that date for it.</p>
        </div>
        <Link className="secondary-action" href="/backoffice/accounting">
          Accounting mappings
        </Link>
      </header>
      <section className="panel">
        <AccountingClosureForm offices={offices} />
      </section>
      <section className="panel">
        <h2>Closed periods</h2>
        {closures.length === 0 ? (
          <p className="empty-state">No office has been closed yet. Once you close a period, new postings dated on/before it will be rejected for that office.</p>
        ) : (
          <ul className="entity-list">
            {closures.map((closure) => (
              <li key={closure.id} className="entity-row">
                <div>
                  <strong>{closure.office.name}</strong>
                  <p>Closed as of {closure.closingDate.toISOString().slice(0, 10)}</p>
                  {closure.comment ? <p className="field-hint">{closure.comment}</p> : null}
                  <p className="field-hint">
                    By {closure.createdByUser.name ?? closure.createdByUser.email} on {closure.createdAt.toISOString().slice(0, 10)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

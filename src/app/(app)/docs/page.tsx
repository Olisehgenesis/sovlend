import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { RoleDocs } from "@/components/role-docs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRolePlaybook, playbookIdForSystemRole } from "@/modules/docs/role-playbooks";

export default async function DocsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [{ role }, user] = await Promise.all([
    searchParams,
    prisma.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true } }),
  ]);
  const initialRole = role ? getRolePlaybook(role).id : playbookIdForSystemRole(user?.systemRole);

  return (
    <main className="directory-page docs-page">
      <Breadcrumbs items={[{ label: "Docs" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Operations playbooks</p>
          <h1>Docs</h1>
          <p>Pick a role. Each playbook lists the actions that class can run, and the exact clicks for the jobs people ask about most.</p>
        </div>
      </header>
      <Suspense fallback={<section className="panel"><p className="muted-text">Loading playbook…</p></section>}>
        <RoleDocs initialRole={initialRole} />
      </Suspense>
    </main>
  );
}

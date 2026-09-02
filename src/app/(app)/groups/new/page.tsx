import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { CreateGroupForm } from "@/components/create-group-form";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";

export default async function NewGroupPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const [offices, staff] = await Promise.all([
    prisma.office.findMany({ where: { organizationId: scope.organizationId, ...(scope.officeIds ? { id: { in: [...scope.officeIds] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { organizationId: scope.organizationId, ...officeWhere(scope) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return <main className="directory-page"><Breadcrumbs items={[{ label: "Groups", href: "/groups" }, { label: "Create group" }]} /><header className="directory-header"><div><p className="eyebrow">Group lending</p><h1>Create group</h1><p>Groups organize clients who borrow or save together &mdash; there is no shared account balance.</p></div><Link className="secondary-action" href="/groups">Cancel</Link></header><section className="panel form-panel"><CreateGroupForm offices={offices} staff={staff} /></section></main>;
}

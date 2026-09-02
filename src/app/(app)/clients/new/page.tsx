import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateClientForm } from "@/components/create-client-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope } from "@/modules/identity/application/data-scope";

export default async function NewClientPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const offices = await prisma.office.findMany({ where: { organizationId: scope.organizationId, ...(scope.officeIds ? { id: { in: [...scope.officeIds] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <main className="directory-page"><Breadcrumbs items={[{ label: "Clients", href: "/clients" }, { label: "Create client" }]} /><header className="directory-header"><div><p className="eyebrow">Customer onboarding</p><h1>Create client</h1><p>Capture identity and assign the borrower to the office responsible for their account.</p></div><Link className="secondary-action" href="/clients">Cancel</Link></header><section className="panel form-panel"><CreateClientForm offices={offices} /></section></main>;
}
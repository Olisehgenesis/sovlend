import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { TransferClientForm } from "@/components/transfer-client-form";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";

export default async function TransferClientPage({ params }: { params: Promise<{ accountNumber: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const { accountNumber } = await params;
  const client = await prisma.client.findFirst({ where: { accountNumber, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!client) notFound();
  const offices = await prisma.office.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } });

  const fullName = [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Clients", href: "/clients" }, { label: fullName, href: `/clients/${accountNumber}` }, { label: "Transfer" }]} />
      <header className="directory-header"><div><p className="eyebrow">Client record</p><h1>Transfer {fullName}</h1><p>Move this client to a different office.</p></div></header>
      <section className="panel form-panel">
        <TransferClientForm accountNumber={accountNumber} clientId={client.id} currentOfficeId={client.officeId} offices={offices} />
      </section>
    </main>
  );
}

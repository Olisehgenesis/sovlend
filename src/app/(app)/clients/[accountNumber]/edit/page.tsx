import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { EditClientForm } from "@/components/edit-client-form";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";

export default async function EditClientPage({ params }: { params: Promise<{ accountNumber: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const { accountNumber } = await params;
  const client = await prisma.client.findFirst({ where: { accountNumber, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!client) notFound();

  const fullName = [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Clients", href: "/clients" }, { label: fullName, href: `/clients/${accountNumber}` }, { label: "Edit" }]} />
      <header className="directory-header"><div><p className="eyebrow">Client record</p><h1>Edit {fullName}</h1><p>Update identity and classification details.</p></div></header>
      <section className="panel form-panel">
        <EditClientForm
          accountNumber={accountNumber}
          client={{
            id: client.id,
            firstName: client.firstName,
            middleName: client.middleName,
            lastName: client.lastName,
            mobileNumber: client.mobileNumber,
            dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
            genderCode: client.genderCode,
            clientTypeCode: client.clientTypeCode,
            classificationCode: client.classificationCode,
            externalId: client.externalId,
          }}
        />
      </section>
    </main>
  );
}

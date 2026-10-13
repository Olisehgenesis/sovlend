import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ApplicationGuarantorsPanel, GuarantorDocuments } from "@/components/application-guarantors-panel";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export default async function GuarantorProfilePage({ params }: { params: Promise<{ profileId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const { profileId } = await params;
  if (!z.uuid().safeParse(profileId).success) notFound();
  const profile = await prisma.guarantorProfile.findFirst({
    where: { id: profileId, application: { office: { organizationId: scope.organizationId }, ...officeWhere(scope) } },
    include: { documents: { orderBy: { createdAt: "desc" } }, application: { include: { loan: { select: { id: true, accountNumber: true } } } } },
  });
  if (!profile) notFound();
  const canManage = (profile.application.status === "SUBMITTED" || profile.application.status === "DRAFT") && await new AuthorizationService(prisma).isAllowed({ actorUserId: session.user.id, organizationId: scope.organizationId, officeId: profile.application.officeId, permission: permissions.loanApply });
  const applicationHref = `/loans/applications/${profile.applicationId}`;
  return <main className="directory-page">
    <Breadcrumbs items={[{ label: "Loans", href: "/loans" }, { label: "Application", href: applicationHref }, { label: "Guarantor profile" }]} />
    <header className="directory-header"><div><p className="eyebrow">Guarantor profile</p><h1>{profile.firstName} {profile.lastName}</h1><p>{profile.clientId ? "Existing system client" : "External guarantor"} · {profile.phone}</p></div><Link className="secondary-action" href={applicationHref}>Back to application</Link></header>
    <section className="panel"><h2>Biodata</h2><dl className="detail-grid">
      {Object.entries({ "Relationship": profile.relationship, "Date of birth": profile.dateOfBirth?.toISOString().slice(0, 10), "Gender": profile.gender, "National ID": profile.nationalId, "Address": profile.address, "Occupation": profile.occupation, "Employer / business": profile.employer, "Bio / background": profile.bio }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not recorded"}</dd></div>)}
    </dl>
      {profile.clientId ? <Link className="green-link" href={`/clients/${profile.clientId}`}>Open linked client</Link> : null}
      {profile.application.loan ? <p><Link className="green-link" href={`/loans/${profile.application.loan.id}?tab=guarantors`}>Loan {profile.application.loan.accountNumber}</Link></p> : null}
      {canManage ? <ApplicationGuarantorsPanel applicationId={profile.applicationId} canManage guarantors={[{
        id: profile.id, firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone,
        clientId: profile.clientId ?? undefined, relationship: profile.relationship ?? undefined,
        dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10), gender: profile.gender ?? undefined,
        nationalId: profile.nationalId ?? undefined, address: profile.address ?? undefined,
        occupation: profile.occupation ?? undefined, employer: profile.employer ?? undefined,
        bio: profile.bio ?? undefined, documents: profile.documents.map(d => ({ id: d.id, name: d.name })),
      }]} /> : null}
    </section>
    <section className="panel"><h2>Guarantor documents</h2><GuarantorDocuments profileId={profile.id} documents={profile.documents.map(d => ({ id: d.id, name: d.name }))} canManage={canManage} /></section>
  </main>;
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { LoanExportsPanel } from "@/components/loan-exports-panel";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export default async function LoanExportsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.loanView,
      organizationId: scope.organizationId,
      officeId: scope.officeIds?.[0] ?? null,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) redirect("/loans");
    throw error;
  }

  const [offices, products, jobs] = await Promise.all([
    prisma.office.findMany({ where: { organizationId: scope.organizationId, ...officeWhere(scope) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.loanProduct.findMany({ where: { organizationId: scope.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.loanExportJob.findMany({
      where: { organizationId: scope.organizationId, requestedById: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Loans", href: "/loans" }, { label: "Full export" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Lending operations</p>
          <h1>Full-fidelity loan export</h1>
          <p>
            Request an auditor-grade export package (schedule, payments, charges, documents, notes, collateral, accounting, audit, reminders) for one loan, a filtered
            set, or the whole portfolio.
          </p>
        </div>
      </header>
      <LoanExportsPanel
        offices={offices}
        products={products}
        initialJobs={jobs.map((job) => ({
          id: job.id,
          scopeType: job.scopeType,
          format: job.format,
          status: job.status,
          asOfDate: job.asOfDate.toISOString().slice(0, 10),
          manifest: job.manifest as { loanCount?: number; datasetCounts?: Record<string, number> } | null,
          resultByteSize: job.resultByteSize,
          errorMessage: job.errorMessage,
          createdAt: job.createdAt.toISOString(),
          completedAt: job.completedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}

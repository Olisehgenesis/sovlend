import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { formatMinor } from "@/modules/money/domain/format-minor";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.loanView, organizationId: scope.organizationId, officeId: scope.officeIds?.[0] ?? null });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot export loans" }, { status: 403 });
    throw error;
  }

  const applications = await prisma.loanApplication.findMany({
    where: { client: { organizationId: scope.organizationId, ...officeWhere(scope) } },
    include: { client: { include: { office: true } }, product: true, loan: true },
    orderBy: { createdAt: "asc" },
  });
  const rows = [
    ["Application ID", "Loan Account", "Borrower", "Client Account", "Office", "Product", "Proposed Principal", "Approved Principal", "Currency", "Application Status", "Loan Status", "Submitted At", "Approved At"],
    ...applications.map((application) => [application.id, application.loan?.accountNumber ?? "", `${application.client.firstName} ${application.client.lastName}`, application.client.accountNumber, application.client.office.name, application.product.name, formatMinor(application.proposedPrincipalMinor, application.product.denominationCurrency), application.approvedPrincipalMinor ? formatMinor(application.approvedPrincipalMinor, application.product.denominationCurrency) : "", application.product.denominationCurrency, application.status, application.loan?.status ?? "", application.submittedAt?.toISOString() ?? "", application.approvedAt?.toISOString() ?? ""]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sovlend-loans-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
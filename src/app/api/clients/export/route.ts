import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.clientView, organizationId: scope.organizationId, officeId: scope.officeIds?.[0] ?? null });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot export clients" }, { status: 403 });
    throw error;
  }

  const clients = await prisma.client.findMany({
    where: { organizationId: scope.organizationId, ...officeWhere(scope) },
    include: { office: { select: { name: true } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const rows = [
    ["Account Number", "First Name", "Middle Name", "Last Name", "Mobile Number", "External ID", "Office", "Status", "Date of Birth"],
    ...clients.map((client) => [client.accountNumber, client.firstName, client.middleName ?? "", client.lastName, client.mobileNumber ?? "", client.externalId ?? "", client.office.name, client.status, client.dateOfBirth?.toISOString().slice(0, 10) ?? ""]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sovlend-clients-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
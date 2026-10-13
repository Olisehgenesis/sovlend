import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace required" }, { status: 403 });
  const application = await prisma.loanApplication.findFirst({ where: { id: (await params).id, office: { organizationId: scope.organizationId }, ...officeWhere(scope) } });
  if (!application) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (!await new AuthorizationService(prisma).isAllowed({ actorUserId: session.user.id, organizationId: scope.organizationId, officeId: application.officeId, permission: permissions.loanApply })) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ clients: [] });
  const clients = await prisma.client.findMany({
    where: { organizationId: scope.organizationId, ...officeWhere(scope), ...(application.clientId ? { id: { not: application.clientId } } : {}),
      OR: ["firstName", "lastName", "accountNumber", "mobileNumber"].map((field) => ({ [field]: { contains: q, mode: "insensitive" } })) },
    select: { id: true, accountNumber: true, firstName: true, lastName: true, mobileNumber: true, dateOfBirth: true, genderCode: true },
    take: 20, orderBy: [{ firstName: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ clients });
}

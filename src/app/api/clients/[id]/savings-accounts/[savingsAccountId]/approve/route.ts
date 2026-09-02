import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; savingsAccountId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id, savingsAccountId } = await params;
  const client = await prisma.client.findFirst({ where: { id, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.savingsApprove, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot approve savings accounts for this client" }, { status: 403 });
    throw error;
  }

  const savingsAccount = await prisma.savingsAccount.findFirst({ where: { id: savingsAccountId, clientId: client.id } });
  if (!savingsAccount) return NextResponse.json({ error: "Savings account not found" }, { status: 404 });
  if (savingsAccount.status !== "SUBMITTED") return NextResponse.json({ error: "Only submitted accounts can be approved" }, { status: 400 });

  // Maker-checker: whoever requested the account cannot also approve it.
  if (savingsAccount.submittedById === session.user.id) return NextResponse.json({ error: "You cannot approve an account you requested yourself" }, { status: 403 });

  await prisma.savingsAccount.update({
    where: { id: savingsAccount.id },
    data: { status: "ACTIVE", approvedById: session.user.id, approvedOn: new Date() },
  });
  return NextResponse.json({ ok: true });
}

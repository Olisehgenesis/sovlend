import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { clientScopeWhere, getUserDataScope, type UserDataScope } from "@/modules/identity/application/data-scope";
import { BTC_ACCOUNT_STATUSES } from "@/modules/btc/domain/valuation";
import { permissions } from "@/modules/identity/domain/permissions";

const updateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().min(1).max(200).nullable().optional(),
  manualBalanceSats: z.coerce.number().int().min(0).optional(),
  status: z.enum(BTC_ACCOUNT_STATUSES).optional(),
});

async function loadAuthorizedAccount(clientId: string, btcAccountId: string, organizationId: string, scope: UserDataScope) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId, ...clientScopeWhere(scope) } });
  if (!client) return null;
  const account = await prisma.clientBtcAccount.findFirst({ where: { id: btcAccountId, clientId: client.id } });
  if (!account) return null;
  return { client, account };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; btcAccountId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid BTC account update" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, btcAccountId } = await params;
  const found = await loadAuthorizedAccount(id, btcAccountId, scope.organizationId, scope);
  if (!found) return NextResponse.json({ error: "BTC account not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.btcAccountManage, organizationId: scope.organizationId, officeId: found.client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot update this BTC account" }, { status: 403 });
    throw error;
  }

  await prisma.clientBtcAccount.update({
    where: { id: found.account.id },
    data: {
      label: parsed.data.label,
      address: parsed.data.address === undefined ? undefined : parsed.data.address,
      manualBalanceSats: parsed.data.manualBalanceSats === undefined ? undefined : BigInt(parsed.data.manualBalanceSats),
      status: parsed.data.status,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; btcAccountId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const { id, btcAccountId } = await params;
  const found = await loadAuthorizedAccount(id, btcAccountId, scope.organizationId, scope);
  if (!found) return NextResponse.json({ error: "BTC account not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.btcAccountManage, organizationId: scope.organizationId, officeId: found.client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot remove this BTC account" }, { status: 403 });
    throw error;
  }

  await prisma.clientBtcAccount.delete({ where: { id: found.account.id } });
  return NextResponse.json({ ok: true });
}

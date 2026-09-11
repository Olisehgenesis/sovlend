import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { loadClientBtcAccounts } from "@/modules/btc/application/load-client-btc-accounts";
import { clientScopeWhere, getUserDataScope } from "@/modules/identity/application/data-scope";
import { BTC_ACCOUNT_SOURCES } from "@/modules/btc/domain/valuation";
import { permissions } from "@/modules/identity/domain/permissions";

const createSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    balanceSource: z.enum(BTC_ACCOUNT_SOURCES),
    address: z.string().trim().min(1).max(200).optional(),
    manualBalanceSats: z.coerce.number().int().min(0).optional(),
  })
  .refine((value) => value.balanceSource !== "ON_CHAIN_ADDRESS" || Boolean(value.address), {
    message: "An address is required for an on-chain-tracked account",
    path: ["address"],
  });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const client = await prisma.client.findFirst({ where: { id, organizationId: scope.organizationId, ...clientScopeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const accounts = await loadClientBtcAccounts(prisma, client.id);
  return NextResponse.json({
    accounts: accounts.map((account) => ({
      ...account,
      balanceSats: account.balanceSats.toString(),
      balanceAsOf: account.balanceAsOf?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid BTC account" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const client = await prisma.client.findFirst({ where: { id, organizationId: scope.organizationId, ...clientScopeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.btcAccountManage, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot add a BTC account for this client" }, { status: 403 });
    throw error;
  }

  const account = await prisma.clientBtcAccount.create({
    data: {
      organizationId: scope.organizationId,
      clientId: client.id,
      label: parsed.data.label,
      balanceSource: parsed.data.balanceSource,
      address: parsed.data.address ?? null,
      manualBalanceSats: BigInt(parsed.data.manualBalanceSats ?? 0),
      createdById: session.user.id,
    },
  });

  return NextResponse.json({ id: account.id }, { status: 201 });
}

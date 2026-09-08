import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { clientScopeWhere, getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { postSavingsTransaction } from "@/modules/savings/application/post-savings-transaction";

const schema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL"]),
  amount: z.coerce.number().positive(),
  settlementAccountId: z.string().uuid(),
  reason: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string; savingsAccountId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid transaction" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id, savingsAccountId } = await params;
  const client = await prisma.client.findFirst({ where: { id, organizationId: scope.organizationId, ...clientScopeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.savingsTransact, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot transact on this savings account" }, { status: 403 });
    throw error;
  }

  const savingsAccount = await prisma.savingsAccount.findFirst({ where: { id: savingsAccountId, clientId: client.id }, select: { id: true } });
  if (!savingsAccount) return NextResponse.json({ error: "Savings account not found" }, { status: 404 });

  const amountMinor = BigInt(Math.round(parsed.data.amount * 100));

  try {
    await postSavingsTransaction(prisma, {
      savingsAccountId: savingsAccount.id,
      actorUserId: session.user.id,
      transactionType: parsed.data.type,
      amountMinor,
      settlementAccountId: parsed.data.settlementAccountId,
      reason: parsed.data.reason || undefined,
      idempotencyKey: parsed.data.idempotencyKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction failed";
    if (message === "Withdrawal exceeds available balance") return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const balance = await prisma.savingsTransaction.findMany({
    where: { savingsAccountId: savingsAccount.id },
    select: { amountMinor: true },
  });
  return NextResponse.json({ ok: true, balanceMinor: balance.reduce((sum, transaction) => sum + transaction.amountMinor, 0n).toString() });
}

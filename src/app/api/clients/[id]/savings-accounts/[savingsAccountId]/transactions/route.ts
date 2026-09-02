import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL"]),
  amount: z.coerce.number().positive(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string; savingsAccountId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid transaction" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id, savingsAccountId } = await params;
  const client = await prisma.client.findFirst({ where: { id, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.savingsTransact, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot transact on this savings account" }, { status: 403 });
    throw error;
  }

  const savingsAccount = await prisma.savingsAccount.findFirst({ where: { id: savingsAccountId, clientId: client.id }, include: { transactions: true } });
  if (!savingsAccount) return NextResponse.json({ error: "Savings account not found" }, { status: 404 });
  if (savingsAccount.status !== "ACTIVE") return NextResponse.json({ error: "Savings account is not active" }, { status: 400 });

  const amountMinor = BigInt(Math.round(parsed.data.amount * 100));
  const currentBalance = savingsAccount.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
  const signedAmountMinor = parsed.data.type === "DEPOSIT" ? amountMinor : -amountMinor;
  if (parsed.data.type === "WITHDRAWAL" && amountMinor > currentBalance) {
    return NextResponse.json({ error: "Withdrawal exceeds available balance" }, { status: 409 });
  }

  await prisma.savingsTransaction.create({
    data: { savingsAccountId: savingsAccount.id, transactionType: parsed.data.type, amountMinor: signedAmountMinor, idempotencyKey: randomUUID() },
  });
  return NextResponse.json({ ok: true, balanceMinor: (currentBalance + signedAmountMinor).toString() });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { clientScopeWhere, getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { MEMBER_CONTRIBUTION_SAVINGS_SHORT_NAME } from "@/modules/lending/domain/disbursement-payout";
import { postSavingsTransaction } from "@/modules/savings/application/post-savings-transaction";

const schema = z.object({
  savingsAccountId: z.string().uuid(),
  creditAccountId: z.string().uuid(),
  amountMinor: z.string().regex(/^\d+$/),
  businessDate: z.iso.date(),
  narration: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid journal" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const client = await prisma.client.findFirst({
    where: { id, organizationId: scope.organizationId, ...clientScopeWhere(scope) },
    select: { id: true, officeId: true, firstName: true, middleName: true, lastName: true },
  });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.ledgerPost,
      organizationId: scope.organizationId,
      officeId: client.officeId,
      amountMinor: BigInt(parsed.data.amountMinor),
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to post journals for this client" }, { status: 403 });
    throw error;
  }

  const savingsAccount = await prisma.savingsAccount.findFirst({
    where: { id: parsed.data.savingsAccountId, clientId: client.id, status: "ACTIVE" },
    select: { id: true, product: { select: { shortName: true } } },
  });
  if (!savingsAccount) return NextResponse.json({ error: "Savings account not found" }, { status: 404 });

  const payeeName = [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");
  const amountMinor = BigInt(parsed.data.amountMinor);
  if (amountMinor <= 0n) return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });

  try {
    await postSavingsTransaction(prisma, {
      savingsAccountId: savingsAccount.id,
      actorUserId: session.user.id,
      transactionType: "WITHDRAWAL",
      amountMinor,
      counterLedgerAccountId: parsed.data.creditAccountId,
      payeeName,
      reason: parsed.data.narration || `Journal from ${savingsAccount.product?.shortName === MEMBER_CONTRIBUTION_SAVINGS_SHORT_NAME ? "member contribution" : "savings"} · ${payeeName}`,
      idempotencyKey: parsed.data.idempotencyKey,
      businessDate: new Date(`${parsed.data.businessDate}T00:00:00.000Z`),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Journal could not be posted";
    if (message === "Withdrawal exceeds available balance") return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

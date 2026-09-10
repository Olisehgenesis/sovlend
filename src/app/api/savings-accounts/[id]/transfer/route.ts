import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { transferSavingsToSavings } from "@/modules/savings/application/transfer-savings";

const schema = z.object({
  toSavingsAccountId: z.string().uuid(),
  amountMinor: z.string().regex(/^\d+$/),
  businessDate: z.iso.date(),
  externalReference: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().uuid(),
});

// Internal transfer: moves money between two of a member's own savings sub-accounts, with no
// settlement/cash account involved. See transferSavingsToSavings() for the accounting treatment.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid transfer" }, { status: 400 });
  try {
    const transaction = await transferSavingsToSavings(prisma, {
      fromSavingsAccountId: (await params).id,
      toSavingsAccountId: parsed.data.toSavingsAccountId,
      actorUserId: session.user.id,
      amountMinor: BigInt(parsed.data.amountMinor),
      businessDate: new Date(`${parsed.data.businessDate}T00:00:00.000Z`),
      externalReference: parsed.data.externalReference || undefined,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ transactionId: transaction.id });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to transfer between savings accounts" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Transfer failed" }, { status: 400 });
  }
}

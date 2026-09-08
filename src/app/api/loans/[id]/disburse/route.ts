import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { disburseLoan } from "@/modules/lending/application/disburse-loan";

const destinationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SETTLEMENT_ACCOUNT"), settlementAccountId: z.string().uuid() }),
  z.object({ type: z.literal("SAVINGS_ACCOUNT"), savingsAccountId: z.string().uuid().optional() }),
]);

const schema = z
  .object({
    settlementAccountId: z.string().uuid().optional(),
    destination: destinationSchema.optional(),
    businessDate: z.iso.date(),
    externalReference: z.string().trim().max(200).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, ctx) => {
    if (!value.destination && !value.settlementAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select where the disbursement should go",
        path: ["destination"],
      });
    }
  })
  .transform((value) => ({
    businessDate: value.businessDate,
    externalReference: value.externalReference,
    idempotencyKey: value.idempotencyKey,
    destination:
      value.destination ??
      ({
        type: "SETTLEMENT_ACCOUNT",
        settlementAccountId: value.settlementAccountId!,
      } as const),
  }));

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid disbursement" }, { status: 400 });
  try {
    const transaction = await disburseLoan(prisma, {
      loanId: (await params).id,
      actorUserId: session.user.id,
      destination: parsed.data.destination,
      businessDate: new Date(`${parsed.data.businessDate}T00:00:00.000Z`),
      externalReference: parsed.data.externalReference || undefined,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ transactionId: transaction.id });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to disburse this loan" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Disbursement failed" }, { status: 400 });
  }
}
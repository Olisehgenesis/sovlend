import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { PAYEE_TYPES } from "@/modules/ledger/domain/journal";
import { disburseLoanAndPayOffPrevious } from "@/modules/lending/application/disburse-loan";

const schema = z.object({
  savingsAccountId: z.string().uuid().optional(),
  paymentMethodSettlementAccountId: z.string().uuid().optional(),
  businessDate: z.iso.date(),
  externalReference: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().uuid(),
  topUpOfLoanId: z.string().uuid().optional(),
  payeeType: z.enum(PAYEE_TYPES).optional(),
  payeeName: z.string().trim().max(200).optional(),
  payeeReference: z.string().trim().max(200).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid disbursement" }, { status: 400 });
  try {
    const { disbursement, payoff } = await disburseLoanAndPayOffPrevious(prisma, {
      loanId: (await params).id,
      actorUserId: session.user.id,
      savingsAccountId: parsed.data.savingsAccountId,
      paymentMethodSettlementAccountId: parsed.data.paymentMethodSettlementAccountId,
      businessDate: new Date(`${parsed.data.businessDate}T00:00:00.000Z`),
      externalReference: parsed.data.externalReference || undefined,
      idempotencyKey: parsed.data.idempotencyKey,
      topUpOfLoanId: parsed.data.topUpOfLoanId,
      payeeType: parsed.data.payeeType,
      payeeName: parsed.data.payeeName,
      payeeReference: parsed.data.payeeReference,
    });
    return NextResponse.json({
      transactionId: disbursement.id,
      payoffTransactionId: payoff?.id ?? null,
      payoffAmountMinor: payoff?.settlementAmountMinor?.toString() ?? null,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to disburse this loan" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Disbursement failed" }, { status: 400 });
  }
}
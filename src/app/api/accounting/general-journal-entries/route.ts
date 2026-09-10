import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { recordJournalEntry } from "@/modules/ledger/application/record-journal-entry";

const lineSchema = z.object({
  ledgerAccountId: z.string().uuid(),
  amountMinor: z.string().regex(/^\d+$/),
});

const schema = z.object({
  officeId: z.string().uuid(),
  currencyCode: z.string().min(1).max(10),
  businessDate: z.iso.date(),
  referenceNumber: z.string().trim().max(60).nullable().optional(),
  narration: z.string().trim().max(200).optional().default(""),
  debits: z.array(lineSchema).min(1),
  credits: z.array(lineSchema).min(1),
  paymentDetails: z
    .object({
      paymentType: z.string().trim().max(60).nullable().optional(),
      accountNumber: z.string().trim().max(60).nullable().optional(),
      checkNumber: z.string().trim().max(60).nullable().optional(),
      receiptNumber: z.string().trim().max(60).nullable().optional(),
      bankNumber: z.string().trim().max(60).nullable().optional(),
    })
    .nullable()
    .optional(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "No organization for this user" }, { status: 400 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid journal entry" }, { status: 400 });

  try {
    const journal = await recordJournalEntry(prisma, {
      organizationId: scope.organizationId,
      officeId: parsed.data.officeId,
      actorUserId: session.user.id,
      currencyCode: parsed.data.currencyCode,
      businessDate: new Date(`${parsed.data.businessDate}T00:00:00.000Z`),
      referenceNumber: parsed.data.referenceNumber?.trim() || null,
      narration: parsed.data.narration ?? "",
      debits: parsed.data.debits.map((line) => ({ ledgerAccountId: line.ledgerAccountId, amountMinor: BigInt(line.amountMinor) })),
      credits: parsed.data.credits.map((line) => ({ ledgerAccountId: line.ledgerAccountId, amountMinor: BigInt(line.amountMinor) })),
      paymentDetails: parsed.data.paymentDetails
        ? {
            paymentType: parsed.data.paymentDetails.paymentType?.trim() || null,
            accountNumber: parsed.data.paymentDetails.accountNumber?.trim() || null,
            checkNumber: parsed.data.paymentDetails.checkNumber?.trim() || null,
            receiptNumber: parsed.data.paymentDetails.receiptNumber?.trim() || null,
            bankNumber: parsed.data.paymentDetails.bankNumber?.trim() || null,
          }
        : null,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ journalId: journal.id });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to post accounting entries" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Journal entry could not be recorded" }, { status: 400 });
  }
}

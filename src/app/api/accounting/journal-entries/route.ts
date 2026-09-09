import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { recordManualJournalEntry } from "@/modules/ledger/application/record-manual-journal-entry";

const schema = z.object({
  entryType: z.enum(["INCOME", "EXPENSE"]),
  officeId: z.string().uuid(),
  ledgerAccountId: z.string().uuid(),
  settlementAccountId: z.string().uuid(),
  amountMinor: z.string().regex(/^\d+$/),
  businessDate: z.iso.date(),
  narration: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "No organization for this user" }, { status: 400 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" }, { status: 400 });

  try {
    const journal = await recordManualJournalEntry(prisma, {
      organizationId: scope.organizationId,
      officeId: parsed.data.officeId,
      actorUserId: session.user.id,
      entryType: parsed.data.entryType,
      ledgerAccountId: parsed.data.ledgerAccountId,
      settlementAccountId: parsed.data.settlementAccountId,
      amountMinor: BigInt(parsed.data.amountMinor),
      businessDate: new Date(`${parsed.data.businessDate}T00:00:00.000Z`),
      narration: parsed.data.narration,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ journalId: journal.id });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to post accounting entries" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Entry could not be recorded" }, { status: 400 });
  }
}

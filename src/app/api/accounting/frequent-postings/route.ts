import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { postAccountingRuleTransaction } from "@/modules/ledger/application/post-accounting-rule-transaction";

const schema = z.object({
  ruleId: z.string().uuid(),
  officeId: z.string().uuid(),
  amountMinor: z.string().regex(/^\d+$/),
  businessDate: z.iso.date(),
  narration: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  debitAccountId: z.string().uuid().optional(),
  creditAccountId: z.string().uuid().optional(),
});

// "Frequent Postings": posts a two-sided journal entry using a predefined Accounting Rule (see
// /api/accounting/rules) instead of picking raw accounts each time. Gated on the same
// LEDGER_POST permission as manual income/expense recording -- selecting a pre-approved rule
// and entering an amount is a routine day-to-day action, unlike defining the rule itself.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "No organization for this user" }, { status: 400 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid posting" }, { status: 400 });

  try {
    const journal = await postAccountingRuleTransaction(prisma, {
      organizationId: scope.organizationId,
      officeId: parsed.data.officeId,
      actorUserId: session.user.id,
      ruleId: parsed.data.ruleId,
      amountMinor: BigInt(parsed.data.amountMinor),
      businessDate: new Date(`${parsed.data.businessDate}T00:00:00.000Z`),
      narration: parsed.data.narration,
      idempotencyKey: parsed.data.idempotencyKey,
      debitAccountId: parsed.data.debitAccountId,
      creditAccountId: parsed.data.creditAccountId,
    });
    return NextResponse.json({ journalId: journal.id });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to post accounting entries" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Posting could not be recorded" }, { status: 400 });
  }
}

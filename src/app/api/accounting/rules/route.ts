import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { saveAccountingRule } from "@/modules/ledger/application/manage-accounting-rules";
import { requireSuperAdminForAccountingApi } from "../_auth";

const accountSelectionSchema = z.object({ accountId: z.string().uuid(), side: z.enum(["DEBIT", "CREDIT"]) });

const schema = z.object({
  id: z.string().uuid().optional(),
  officeId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional(),
  active: z.boolean().default(true),
  accounts: z.array(accountSelectionSchema).min(2),
});

// Creates or updates a named debit/credit posting template ("Accounting Rule") -- e.g. "Petty
// Cash Replenishment: Dr Office Supplies Expense, Cr Cash" -- used by the Frequent Postings
// flow (see /api/accounting/frequent-postings) so a poster can select it by name instead of
// picking raw accounts every time. Restricted to platform super-admins, same as every other
// accounting-structure mutation (GL accounts, settlement/product mappings): defining the
// templates is a rare, high-risk structural change; posting with one is a routine LEDGER_POST
// action gated separately.
export async function POST(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid accounting rule" }, { status: 400 });

  const input = parsed.data;
  try {
    const rule = await saveAccountingRule(prisma, {
      ruleId: input.id,
      organizationId: authResult.organizationId,
      officeId: input.officeId,
      name: input.name,
      description: input.description ?? null,
      active: input.active,
      accounts: input.accounts,
    });
    return NextResponse.json({ id: rule.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Accounting rule could not be saved" }, { status: 400 });
  }
}

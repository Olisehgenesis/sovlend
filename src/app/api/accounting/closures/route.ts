import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAccountingClosure } from "@/modules/ledger/application/manage-accounting-closures";
import { requireSuperAdminForAccountingApi } from "../_auth";

const schema = z.object({
  officeId: z.string().uuid(),
  closingDate: z.iso.date(),
  comment: z.string().trim().max(300).optional(),
});

// Creates a period-end lock ("Closing Entries" in iLend/Mifos terms) for an office: once
// created, every journal-posting code path (loan disbursement, repayment, loan service actions,
// savings transactions, penalty assessment, manual/frequent postings) rejects new postings dated
// on or before the closure's closingDate for that office. Restricted to platform super-admins,
// same as every other accounting-structure mutation -- this is a rare, high-blast-radius action,
// distinct from the routine LEDGER_POST permission used for day-to-day postings.
export async function POST(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid closing entry" }, { status: 400 });

  const input = parsed.data;
  try {
    const closure = await createAccountingClosure(prisma, {
      organizationId: authResult.organizationId,
      officeId: input.officeId,
      actorUserId: authResult.userId,
      closingDate: new Date(`${input.closingDate}T00:00:00.000Z`),
      comment: input.comment ?? null,
    });
    return NextResponse.json({ id: closure.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Closing entry could not be created" }, { status: 400 });
  }
}

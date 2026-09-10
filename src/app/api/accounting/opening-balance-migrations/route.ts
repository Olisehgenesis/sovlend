import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { PeriodClosedError } from "@/modules/ledger/application/assert-period-open";
import { migrateOpeningBalance } from "@/modules/ledger/application/migrate-opening-balance";
import { requireSuperAdminForAccountingApi } from "../_auth";

const schema = z.object({
  officeId: z.string().uuid(),
  ledgerAccountId: z.string().uuid(),
  asOfDate: z.iso.date(),
  direction: z.enum(["DEBIT", "CREDIT"]),
  amountMinor: z.string().regex(/^\d+$/),
  narration: z.string().trim().max(200).optional(),
});

// "Migrate Opening Balances (Office-wise)": a one-time, super-admin-only action to set a GL
// account's starting balance at a specific office as of a date. See migrate-opening-balance.ts
// for why this is intentionally one-time-per-office-per-account rather than amendable.
export async function POST(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  try {
    const result = await migrateOpeningBalance(prisma, {
      organizationId: authResult.organizationId,
      officeId: parsed.data.officeId,
      actorUserId: authResult.userId,
      ledgerAccountId: parsed.data.ledgerAccountId,
      asOfDate: new Date(`${parsed.data.asOfDate}T00:00:00.000Z`),
      direction: parsed.data.direction,
      amountMinor: BigInt(parsed.data.amountMinor),
      narration: parsed.data.narration,
    });
    return NextResponse.json({
      alreadyMigrated: result.alreadyMigrated,
      migration: {
        id: result.migration.id,
        ledgerAccountId: result.migration.ledgerAccountId,
        officeId: result.migration.officeId,
        direction: result.migration.direction,
        amountMinor: result.migration.amountMinor.toString(),
        journalId: result.migration.journalId,
      },
    });
  } catch (error) {
    if (error instanceof PeriodClosedError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opening balance could not be migrated" }, { status: 400 });
  }
}

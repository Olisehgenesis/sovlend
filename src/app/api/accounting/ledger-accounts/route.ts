import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireSuperAdminForAccountingApi } from "../_auth";

const schema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(150),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  currencyCode: z.string().min(3).max(10),
  usage: z.enum(["DETAIL", "HEADER"]).default("DETAIL"),
  description: z.string().trim().max(300).optional(),
  manualEntriesAllowed: z.boolean().default(true),
  active: z.boolean().default(true),
});

// Creates a new entry in the shared chart of accounts (LedgerAccount has no organizationId --
// it's a single org-wide chart, see prisma/schema.prisma). Restricted to platform super-admins,
// same as every other accounting-structure mutation in this API namespace (settlement mappings,
// product mappings) -- adding/removing GL accounts is a rare, high-risk structural change, unlike
// day-to-day income/expense postings which any LEDGER_POST holder can make.
export async function POST(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid account" }, { status: 400 });

  const input = parsed.data;
  const currency = await prisma.currency.findUnique({ where: { code: input.currencyCode } });
  if (!currency) return NextResponse.json({ error: "Unknown currency code" }, { status: 400 });

  const existing = await prisma.ledgerAccount.findFirst({ where: { code: input.code, currencyCode: input.currencyCode, ownershipPoolId: null } });
  if (existing) return NextResponse.json({ error: `Account code ${input.code} already exists for ${input.currencyCode}` }, { status: 409 });

  const account = await prisma.ledgerAccount.create({
    data: {
      code: input.code,
      name: input.name,
      type: input.type,
      currencyCode: input.currencyCode,
      usage: input.usage,
      description: input.description || null,
      manualEntriesAllowed: input.manualEntriesAllowed,
      active: input.active,
    },
  });
  return NextResponse.json({ id: account.id });
}

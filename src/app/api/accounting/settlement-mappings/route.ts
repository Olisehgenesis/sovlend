import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireSuperAdminForAccountingApi } from "../_auth";

const schema = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  type: z.enum(["CASH", "BANK", "MOBILE_MONEY"]),
  provider: z.string().trim().max(100).optional(),
  accountReference: z.string().trim().max(120).optional(),
  currencyCode: z.string().min(3).max(10),
  ledgerAccountId: z.string().uuid(),
  active: z.boolean().default(true),
});

export async function POST(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settlement mapping" }, { status: 400 });
  }

  const input = parsed.data;
  if (authResult.organizationId !== input.organizationId) return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  const ledgerAccount = await prisma.ledgerAccount.findFirst({ where: { id: input.ledgerAccountId, currencyCode: input.currencyCode, active: true, usage: "DETAIL", type: "ASSET" } });
  if (!ledgerAccount) return NextResponse.json({ error: "Settlement mapping requires an active detail asset account in the same currency" }, { status: 400 });
  const values = {
    organizationId: input.organizationId,
    name: input.name,
    type: input.type,
    provider: input.provider || null,
    accountReference: input.accountReference || null,
    currencyCode: input.currencyCode,
    ledgerAccountId: input.ledgerAccountId,
    active: input.active,
  };
  const settlementAccount = input.id
    ? await prisma.settlementAccount.update({ where: { id: input.id, organizationId: input.organizationId }, data: values })
    : await prisma.settlementAccount.create({ data: values });
  return NextResponse.json({ id: settlementAccount.id });
}
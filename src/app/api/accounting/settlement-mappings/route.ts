import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const input = schema.parse(await request.json());
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (user?.organizationId !== input.organizationId) return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
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
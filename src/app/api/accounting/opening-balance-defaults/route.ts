import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireSuperAdminForAccountingApi } from "../_auth";

const schema = z.object({
  organizationId: z.string().uuid(),
  openingBalanceEquityAccountId: z.string().uuid(),
});

export async function GET() {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const defaults = await prisma.openingBalanceAccountingDefaults.findUnique({
    where: { organizationId: authResult.organizationId },
    select: {
      id: true,
      organizationId: true,
      openingBalanceEquityAccountId: true,
    },
  });

  return NextResponse.json({ defaults });
}

async function upsertOpeningBalanceDefaults(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid opening balance defaults" }, { status: 400 });
  }

  const input = parsed.data;
  if (input.organizationId !== authResult.organizationId) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  }

  const equityAccount = await prisma.ledgerAccount.findFirst({
    where: { id: input.openingBalanceEquityAccountId, currencyCode: "UGX", active: true, usage: "DETAIL", type: "EQUITY" },
  });
  if (!equityAccount) {
    return NextResponse.json(
      { error: "Opening balance equity account must be an active detail equity account in UGX" },
      { status: 400 },
    );
  }

  const defaults = await prisma.openingBalanceAccountingDefaults.upsert({
    where: { organizationId: input.organizationId },
    create: input,
    update: { openingBalanceEquityAccountId: input.openingBalanceEquityAccountId },
  });
  return NextResponse.json({ id: defaults.id });
}

export async function POST(request: Request) {
  return upsertOpeningBalanceDefaults(request);
}

export async function PUT(request: Request) {
  return upsertOpeningBalanceDefaults(request);
}

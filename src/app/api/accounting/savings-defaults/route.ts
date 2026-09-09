import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireSuperAdminForAccountingApi } from "../_auth";

const schema = z.object({
  organizationId: z.string().uuid(),
  savingsLiabilityAccountId: z.string().uuid(),
});

export async function GET() {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const defaults = await prisma.savingsAccountingDefaults.findUnique({
    where: { organizationId: authResult.organizationId },
    select: {
      id: true,
      organizationId: true,
      savingsLiabilityAccountId: true,
    },
  });

  return NextResponse.json({ defaults });
}

async function upsertSavingsDefaults(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid savings defaults" }, { status: 400 });
  }

  const input = parsed.data;
  if (input.organizationId !== authResult.organizationId) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  }

  const ledgerAccount = await prisma.ledgerAccount.findFirst({
    where: {
      id: input.savingsLiabilityAccountId,
      currencyCode: "UGX",
      active: true,
      usage: "DETAIL",
      type: "LIABILITY",
    },
  });
  if (!ledgerAccount) {
    return NextResponse.json(
      { error: "Savings default requires an active detail liability account in UGX" },
      { status: 400 },
    );
  }

  const defaults = await prisma.savingsAccountingDefaults.upsert({
    where: { organizationId: input.organizationId },
    create: input,
    update: { savingsLiabilityAccountId: input.savingsLiabilityAccountId },
  });
  return NextResponse.json({ id: defaults.id });
}

export async function POST(request: Request) {
  return upsertSavingsDefaults(request);
}

export async function PUT(request: Request) {
  return upsertSavingsDefaults(request);
}

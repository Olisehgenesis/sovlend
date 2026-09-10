import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireSuperAdminForAccountingApi } from "../_auth";

const schema = z.object({
  organizationId: z.string().uuid(),
  provisionExpenseAccountId: z.string().uuid(),
  loanLossProvisionAccountId: z.string().uuid(),
});

export async function GET() {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const defaults = await prisma.provisioningAccountingDefaults.findUnique({
    where: { organizationId: authResult.organizationId },
    select: {
      id: true,
      organizationId: true,
      provisionExpenseAccountId: true,
      loanLossProvisionAccountId: true,
    },
  });

  return NextResponse.json({ defaults });
}

async function upsertProvisioningDefaults(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid provisioning defaults" }, { status: 400 });
  }

  const input = parsed.data;
  if (input.organizationId !== authResult.organizationId) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  }

  const [expenseAccount, provisionAccount] = await Promise.all([
    prisma.ledgerAccount.findFirst({
      where: { id: input.provisionExpenseAccountId, currencyCode: "UGX", active: true, usage: "DETAIL", type: "EXPENSE" },
    }),
    prisma.ledgerAccount.findFirst({
      where: { id: input.loanLossProvisionAccountId, currencyCode: "UGX", active: true, usage: "DETAIL" },
    }),
  ]);
  if (!expenseAccount) {
    return NextResponse.json({ error: "Provision expense account must be an active detail expense account in UGX" }, { status: 400 });
  }
  if (!provisionAccount) {
    return NextResponse.json({ error: "Loan loss provision account must be an active detail account in UGX" }, { status: 400 });
  }

  const defaults = await prisma.provisioningAccountingDefaults.upsert({
    where: { organizationId: input.organizationId },
    create: input,
    update: {
      provisionExpenseAccountId: input.provisionExpenseAccountId,
      loanLossProvisionAccountId: input.loanLossProvisionAccountId,
    },
  });
  return NextResponse.json({ id: defaults.id });
}

export async function POST(request: Request) {
  return upsertProvisioningDefaults(request);
}

export async function PUT(request: Request) {
  return upsertProvisioningDefaults(request);
}

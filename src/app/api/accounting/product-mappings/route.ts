import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireSuperAdminForAccountingApi } from "../_auth";

const schema = z.object({
  productId: z.string().uuid(),
  principalReceivableAccountId: z.string().uuid(),
  interestIncomeAccountId: z.string().uuid(),
  feeIncomeAccountId: z.string().uuid().nullable(),
  monitoringFeeIncomeAccountId: z.string().uuid().nullable(),
  processingFeeIncomeAccountId: z.string().uuid().nullable(),
  admissionFeeIncomeAccountId: z.string().uuid().nullable(),
  penaltyIncomeAccountId: z.string().uuid().nullable(),
  penaltyReceivableAccountId: z.string().uuid().nullable(),
  writeOffExpenseAccountId: z.string().uuid().nullable(),
  overpaymentLiabilityAccountId: z.string().uuid().nullable(),
});

export async function GET() {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const products = await prisma.loanProduct.findMany({
    where: { organizationId: authResult.organizationId },
    select: {
      id: true,
      name: true,
      denominationCurrency: true,
      accountingMapping: {
        select: {
          id: true,
          principalReceivableAccountId: true,
          interestIncomeAccountId: true,
          feeIncomeAccountId: true,
          monitoringFeeIncomeAccountId: true,
          processingFeeIncomeAccountId: true,
          admissionFeeIncomeAccountId: true,
          penaltyIncomeAccountId: true,
          penaltyReceivableAccountId: true,
          writeOffExpenseAccountId: true,
          overpaymentLiabilityAccountId: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ products });
}

async function upsertProductMapping(request: Request) {
  const authResult = await requireSuperAdminForAccountingApi();
  if ("error" in authResult) return authResult.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid product mapping" }, { status: 400 });
  }

  const input = parsed.data;
  const product = await prisma.loanProduct.findFirst({
    where: { id: input.productId, organizationId: authResult.organizationId },
  });
  if (!product) return NextResponse.json({ error: "Loan product not found" }, { status: 404 });
  const accountIds = Object.values(input).filter((value): value is string => typeof value === "string" && value !== input.productId);
  const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: accountIds }, currencyCode: product.denominationCurrency, active: true, usage: "DETAIL" } });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  if (byId.get(input.principalReceivableAccountId)?.type !== "ASSET") return NextResponse.json({ error: "Principal receivable must be an active detail asset account" }, { status: 400 });
  if (byId.get(input.interestIncomeAccountId)?.type !== "REVENUE") return NextResponse.json({ error: "Interest income must be an active detail revenue account" }, { status: 400 });
  for (const id of [input.feeIncomeAccountId, input.monitoringFeeIncomeAccountId, input.processingFeeIncomeAccountId, input.admissionFeeIncomeAccountId, input.penaltyIncomeAccountId]) {
    if (id && byId.get(id)?.type !== "REVENUE") {
      return NextResponse.json({ error: "Fee and penalty income mappings must use revenue accounts" }, { status: 400 });
    }
  }
  if (input.penaltyReceivableAccountId && byId.get(input.penaltyReceivableAccountId)?.type !== "ASSET") {
    return NextResponse.json({ error: "Penalty receivable mapping must use an asset account" }, { status: 400 });
  }
  if (input.writeOffExpenseAccountId && byId.get(input.writeOffExpenseAccountId)?.type !== "EXPENSE") return NextResponse.json({ error: "Write-off mapping must use an expense account" }, { status: 400 });
  if (input.overpaymentLiabilityAccountId && byId.get(input.overpaymentLiabilityAccountId)?.type !== "LIABILITY") return NextResponse.json({ error: "Overpayment mapping must use a liability account" }, { status: 400 });

  const mapping = await prisma.loanProductAccountingMapping.upsert({ where: { productId: product.id }, create: input, update: input });
  return NextResponse.json({ id: mapping.id });
}

export async function POST(request: Request) {
  return upsertProductMapping(request);
}

export async function PUT(request: Request) {
  return upsertProductMapping(request);
}
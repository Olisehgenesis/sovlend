import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  productId: z.string().uuid(),
  principalReceivableAccountId: z.string().uuid(),
  interestIncomeAccountId: z.string().uuid(),
  feeIncomeAccountId: z.string().uuid().nullable(),
  penaltyIncomeAccountId: z.string().uuid().nullable(),
  writeOffExpenseAccountId: z.string().uuid().nullable(),
  overpaymentLiabilityAccountId: z.string().uuid().nullable(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const input = schema.parse(await request.json());
  const product = await prisma.loanProduct.findUnique({ where: { id: input.productId } });
  if (!product) return NextResponse.json({ error: "Loan product not found" }, { status: 404 });
  const accountIds = Object.values(input).filter((value): value is string => typeof value === "string" && value !== input.productId);
  const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: accountIds }, currencyCode: product.denominationCurrency, active: true, usage: "DETAIL" } });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  if (byId.get(input.principalReceivableAccountId)?.type !== "ASSET") return NextResponse.json({ error: "Principal receivable must be an active detail asset account" }, { status: 400 });
  if (byId.get(input.interestIncomeAccountId)?.type !== "REVENUE") return NextResponse.json({ error: "Interest income must be an active detail revenue account" }, { status: 400 });
  for (const id of [input.feeIncomeAccountId, input.penaltyIncomeAccountId]) if (id && byId.get(id)?.type !== "REVENUE") return NextResponse.json({ error: "Fee and penalty mappings must use revenue accounts" }, { status: 400 });
  if (input.writeOffExpenseAccountId && byId.get(input.writeOffExpenseAccountId)?.type !== "EXPENSE") return NextResponse.json({ error: "Write-off mapping must use an expense account" }, { status: 400 });
  if (input.overpaymentLiabilityAccountId && byId.get(input.overpaymentLiabilityAccountId)?.type !== "LIABILITY") return NextResponse.json({ error: "Overpayment mapping must use a liability account" }, { status: 400 });

  const mapping = await prisma.loanProductAccountingMapping.upsert({ where: { productId: product.id }, create: input, update: input });
  return NextResponse.json({ id: mapping.id });
}
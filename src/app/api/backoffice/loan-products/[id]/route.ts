import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { prisma } from "@/lib/prisma";
import { annualBpsFromMonthlyPercent } from "@/modules/lending/domain/monthly-rate";

const archiveSchema = z.object({ active: z.boolean() });
const updateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  shortName: z.string().trim().min(1).max(20),
  denominationCurrency: z.string().trim().min(3).max(10).default("UGX"),
  principalMin: z.coerce.number().min(0),
  principalMax: z.coerce.number().min(0),
  annualRate: z.coerce.number().min(0).max(1000),
  monitoringFeeAnnualRate: z.coerce.number().min(0).max(1000).default(0),
  repaymentCount: z.coerce.number().int().positive(),
  repaymentFrequency: z.string().trim().regex(/^\d+\s+(day|days|week|weeks|month|months)$/i, "Repayment frequency must be like '1 Months'"),
  amortizationMethod: z.string().trim().min(1).max(120),
  interestMethod: z.enum(["Flat", "Declining Balance"]),
  collectCrb: z.boolean().default(true),
});

// Archiving only flips `active`; the row is never deleted so existing loans keep their terms snapshot intact.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allowed, organizationId } = await canManageProducts(session);
  if (!allowed || !organizationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const payload = await request.json();
  const { id } = await params;
  const product = await prisma.loanProduct.findFirst({ where: { id, organizationId } });
  if (!product) return NextResponse.json({ error: "Loan product not found" }, { status: 404 });

  const parsedArchive = archiveSchema.safeParse(payload);
  if (parsedArchive.success) {
    await prisma.loanProduct.update({ where: { id: product.id }, data: { active: parsedArchive.data.active } });
    return NextResponse.json({ ok: true });
  }

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  if (parsed.data.principalMax < parsed.data.principalMin) return NextResponse.json({ error: "Maximum principal must be greater than or equal to the minimum" }, { status: 400 });

  await prisma.loanProduct.update({
    where: { id: product.id },
    data: {
      name: parsed.data.name,
      shortName: parsed.data.shortName,
      denominationCurrency: parsed.data.denominationCurrency,
      principalMinMinor: BigInt(Math.round(parsed.data.principalMin * 100)),
      principalMaxMinor: BigInt(Math.round(parsed.data.principalMax * 100)),
      annualRateBps: annualBpsFromMonthlyPercent(parsed.data.annualRate),
      monitoringFeeAnnualRateBps: annualBpsFromMonthlyPercent(parsed.data.monitoringFeeAnnualRate),
      repaymentCount: parsed.data.repaymentCount,
      repaymentFrequency: parsed.data.repaymentFrequency,
      amortizationMethod: parsed.data.amortizationMethod,
      interestMethod: parsed.data.interestMethod,
      collectCrb: parsed.data.collectCrb,
    },
  });
  return NextResponse.json({ ok: true });
}

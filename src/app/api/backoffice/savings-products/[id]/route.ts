import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { prisma } from "@/lib/prisma";

const archiveSchema = z.object({ active: z.boolean() });
const updateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  shortName: z.string().trim().min(1).max(20),
  description: z.string().trim().max(255).optional(),
  currencyCode: z.string().trim().min(3).max(10).default("UGX"),
  nominalAnnualRate: z.coerce.number().min(0).max(1000).default(0),
  minOpeningBalance: z.coerce.number().min(0).default(0),
});

// Archiving only flips `active`; the row is never deleted so existing savings accounts keep their terms snapshot intact.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allowed, organizationId } = await canManageProducts(session);
  if (!allowed || !organizationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const payload = await request.json();
  const { id } = await params;
  const product = await prisma.savingsProduct.findFirst({ where: { id, organizationId } });
  if (!product) return NextResponse.json({ error: "Savings product not found" }, { status: 404 });

  const parsedArchive = archiveSchema.safeParse(payload);
  if (parsedArchive.success) {
    await prisma.savingsProduct.update({ where: { id: product.id }, data: { active: parsedArchive.data.active } });
    return NextResponse.json({ ok: true });
  }

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  await prisma.savingsProduct.update({
    where: { id: product.id },
    data: {
      name: parsed.data.name,
      shortName: parsed.data.shortName,
      description: parsed.data.description || null,
      currencyCode: parsed.data.currencyCode,
      nominalAnnualRateBps: Math.round(parsed.data.nominalAnnualRate * 100),
      minOpeningBalanceMinor: BigInt(Math.round(parsed.data.minOpeningBalance * 100)),
    },
  });
  return NextResponse.json({ ok: true });
}

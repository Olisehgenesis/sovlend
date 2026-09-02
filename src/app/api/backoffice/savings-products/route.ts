import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(1).max(150),
  shortName: z.string().trim().min(1).max(20),
  description: z.string().trim().max(255).optional(),
  currencyCode: z.string().trim().min(3).max(10).default("UGX"),
  nominalAnnualRate: z.coerce.number().min(0).max(100).default(0),
  minOpeningBalance: z.coerce.number().min(0).default(0),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allowed, organizationId } = await canManageProducts(session);
  if (!allowed || !organizationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid savings product" }, { status: 400 });

  const product = await prisma.savingsProduct.create({
    data: {
      organizationId,
      name: parsed.data.name,
      shortName: parsed.data.shortName,
      description: parsed.data.description || null,
      currencyCode: parsed.data.currencyCode,
      nominalAnnualRateBps: Math.round(parsed.data.nominalAnnualRate * 100),
      minOpeningBalanceMinor: BigInt(Math.round(parsed.data.minOpeningBalance * 100)),
    },
  });
  return NextResponse.json({ id: product.id }, { status: 201 });
}

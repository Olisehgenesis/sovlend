import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { canManageProducts } from "@/lib/can-manage-products";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(1).max(150),
  appliesTo: z.enum(["LOAN", "SAVINGS"]),
  calculationType: z.enum(["FLAT", "PERCENTAGE"]),
  amount: z.coerce.number().min(0).optional(),
  percentage: z.coerce.number().min(0).max(100).optional(),
  currencyCode: z.string().trim().min(3).max(10).default("UGX"),
  penalty: z.boolean().default(false),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allowed, organizationId } = await canManageProducts(session);
  if (!allowed || !organizationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid charge" }, { status: 400 });
  if (parsed.data.calculationType === "FLAT" && parsed.data.amount === undefined) return NextResponse.json({ error: "Amount is required for flat charges" }, { status: 400 });
  if (parsed.data.calculationType === "PERCENTAGE" && parsed.data.percentage === undefined) return NextResponse.json({ error: "Percentage is required for percentage charges" }, { status: 400 });

  const definition = await prisma.chargeDefinition.create({
    data: {
      organizationId,
      name: parsed.data.name,
      appliesTo: parsed.data.appliesTo,
      calculationType: parsed.data.calculationType,
      amountMinor: parsed.data.amount !== undefined ? BigInt(Math.round(parsed.data.amount * 100)) : null,
      percentageBps: parsed.data.percentage !== undefined ? Math.round(parsed.data.percentage * 100) : null,
      currencyCode: parsed.data.currencyCode,
      penalty: parsed.data.penalty,
    },
  });
  return NextResponse.json({ id: definition.id }, { status: 201 });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const archiveSchema = z.object({ active: z.boolean() });
const updateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  appliesTo: z.enum(["LOAN", "SAVINGS"]),
  calculationType: z.enum(["FLAT", "PERCENTAGE"]),
  amount: z.coerce.number().min(0).optional(),
  percentage: z.coerce.number().min(0).max(100).optional(),
  currencyCode: z.string().trim().min(3).max(10).default("UGX"),
  penalty: z.boolean().default(false),
});

// Archiving only flips `active`; the row is never deleted so existing client charges keep their reference intact.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const allowedEmails = (process.env.SUPER_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (session.user.role !== "admin" || !allowedEmails.includes(session.user.email.toLowerCase())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) return NextResponse.json({ error: "Super administrator requires an organization" }, { status: 400 });

  const payload = await request.json();
  const { id } = await params;
  const definition = await prisma.chargeDefinition.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!definition) return NextResponse.json({ error: "Charge not found" }, { status: 404 });

  const parsedArchive = archiveSchema.safeParse(payload);
  if (parsedArchive.success) {
    await prisma.chargeDefinition.update({ where: { id: definition.id }, data: { active: parsedArchive.data.active } });
    return NextResponse.json({ ok: true });
  }

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  if (parsed.data.calculationType === "FLAT" && parsed.data.amount === undefined) return NextResponse.json({ error: "Amount is required for flat charges" }, { status: 400 });
  if (parsed.data.calculationType === "PERCENTAGE" && parsed.data.percentage === undefined) return NextResponse.json({ error: "Percentage is required for percentage charges" }, { status: 400 });

  await prisma.chargeDefinition.update({
    where: { id: definition.id },
    data: {
      name: parsed.data.name,
      appliesTo: parsed.data.appliesTo,
      calculationType: parsed.data.calculationType,
      amountMinor: parsed.data.calculationType === "FLAT" ? BigInt(Math.round((parsed.data.amount ?? 0) * 100)) : null,
      percentageBps: parsed.data.calculationType === "PERCENTAGE" ? Math.round((parsed.data.percentage ?? 0) * 100) : null,
      currencyCode: parsed.data.currencyCode,
      penalty: parsed.data.penalty,
    },
  });
  return NextResponse.json({ ok: true });
}

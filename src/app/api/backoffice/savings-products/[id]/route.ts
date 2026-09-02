import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ active: z.boolean() });

// Archiving only flips `active`; the row is never deleted so existing savings accounts keep their terms snapshot intact.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const allowedEmails = (process.env.SUPER_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (session.user.role !== "admin" || !allowedEmails.includes(session.user.email.toLowerCase())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) return NextResponse.json({ error: "Super administrator requires an organization" }, { status: 400 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { id } = await params;
  const product = await prisma.savingsProduct.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!product) return NextResponse.json({ error: "Savings product not found" }, { status: 404 });

  await prisma.savingsProduct.update({ where: { id: product.id }, data: { active: parsed.data.active } });
  return NextResponse.json({ ok: true });
}

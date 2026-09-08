import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(1).max(150),
  code: z.string().trim().max(40).optional(),
  ledgerAccountId: z.string().uuid().optional(),
  isActive: z.boolean().default(true),
});

async function requireSuperAdminForApi() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const allowedEmails = (process.env.SUPER_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (session.user.role !== "admin" || !allowedEmails.includes(session.user.email.toLowerCase())) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "Super administrator requires an organization" }, { status: 400 }) };
  return { organizationId: user.organizationId };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireSuperAdminForApi();
  if ("error" in authResult) return authResult.error;
  const { organizationId } = authResult;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid fund" }, { status: 400 });

  const { id } = await params;
  const fund = await prisma.fund.findFirst({ where: { id, organizationId } });
  if (!fund) return NextResponse.json({ error: "Fund not found" }, { status: 404 });

  if (parsed.data.ledgerAccountId) {
    const ledgerAccount = await prisma.ledgerAccount.findFirst({ where: { id: parsed.data.ledgerAccountId, active: true, usage: "DETAIL" } });
    if (!ledgerAccount) return NextResponse.json({ error: "Fund mapping requires an active detail ledger account" }, { status: 400 });
  }

  try {
    await prisma.fund.update({
      where: { id: fund.id },
      data: {
        name: parsed.data.name,
        code: parsed.data.code || null,
        ledgerAccountId: parsed.data.ledgerAccountId ?? null,
        isActive: parsed.data.isActive,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A fund with that name or code already exists" }, { status: 409 });
    }
    throw error;
  }
}

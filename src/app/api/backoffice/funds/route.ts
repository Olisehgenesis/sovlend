import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  organizationId: z.string().uuid(),
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

export async function GET() {
  const authResult = await requireSuperAdminForApi();
  if ("error" in authResult) return authResult.error;
  const { organizationId } = authResult;

  const funds = await prisma.fund.findMany({
    where: { organizationId },
    include: { ledgerAccount: { select: { id: true, code: true, name: true, type: true, currencyCode: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ funds });
}

export async function POST(request: Request) {
  const authResult = await requireSuperAdminForApi();
  if ("error" in authResult) return authResult.error;
  const { organizationId } = authResult;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid fund" }, { status: 400 });
  if (parsed.data.organizationId !== organizationId) return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });

  if (parsed.data.ledgerAccountId) {
    const ledgerAccount = await prisma.ledgerAccount.findFirst({ where: { id: parsed.data.ledgerAccountId, active: true, usage: "DETAIL" } });
    if (!ledgerAccount) return NextResponse.json({ error: "Fund mapping requires an active detail ledger account" }, { status: 400 });
  }

  try {
    const fund = await prisma.fund.create({
      data: {
        organizationId: parsed.data.organizationId,
        name: parsed.data.name,
        code: parsed.data.code || null,
        ledgerAccountId: parsed.data.ledgerAccountId ?? null,
        isActive: parsed.data.isActive,
      },
    });
    return NextResponse.json({ id: fund.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A fund with that name or code already exists" }, { status: 409 });
    }
    throw error;
  }
}

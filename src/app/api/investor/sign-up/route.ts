import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  password: z.string().min(6).max(128),
});

/**
 * Self-service investor account creation. Unlike staff/client accounts (created by an
 * administrator), an investor can open an account immediately here -- but the account starts
 * with zero approved business access. Nothing business-specific is exposed until an
 * InvestorOrganizationAccess row is approved (see /api/investor/access), so this endpoint never
 * touches Organization data.
 */
export async function POST(request: Request) {
  const input = schema.parse(await request.json());

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });

  const created = await auth.api.createUser({
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
      role: "user",
      data: { systemRole: "INVESTOR" },
    },
  });

  try {
    await prisma.investorProfile.create({ data: { userId: created.user.id, displayName: input.name } });
  } catch (error) {
    await prisma.user.delete({ where: { id: created.user.id } });
    throw error;
  }

  return NextResponse.json({ created: true }, { status: 201 });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { grantJumpStartAfricaAccess } from "@/modules/investments/application/grant-flagship-access";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  password: z.string().min(6).max(128),
});

/**
 * Self-service investor account creation. Unlike staff/client accounts (created by an
 * administrator), an investor can open an account immediately here and is granted immediate,
 * no-approval access to fund Jump Start Africa -- SovLend's one flagship business today. Any
 * *other* business an investor wants to fund still goes through the reviewed
 * InvestorOrganizationAccess request flow (see /api/investor/access) -- this auto-grant is
 * specific to Jump Start Africa, not a blanket "every business is open" policy, so adding a
 * second business later does not silently expose it to every investor.
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
    const investor = await prisma.investorProfile.create({ data: { userId: created.user.id, displayName: input.name } });
    await grantJumpStartAfricaAccess(prisma, investor.id);
  } catch (error) {
    await prisma.user.delete({ where: { id: created.user.id } });
    throw error;
  }

  return NextResponse.json({ created: true }, { status: 201 });
}

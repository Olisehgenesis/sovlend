import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createInvestorInvite } from "@/modules/investments/application/investor-invites";

const schema = z.object({ organizationId: z.string().uuid(), email: z.email() });

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const input = schema.parse(await request.json());
  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId } });
  if (!organization) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const { invite, token } = await createInvestorInvite(prisma, { ...input, createdById: session.user.id });
  const baseUrl = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  return NextResponse.json({
    id: invite.id,
    expiresAt: invite.expiresAt,
    inviteUrl: `${baseUrl}/investor/join/${token}`,
  }, { status: 201 });
}
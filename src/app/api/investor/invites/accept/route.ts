import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashInviteToken } from "@/modules/investments/application/investor-invites";

const schema = z.object({
  token: z.string().min(32),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(6).max(128),
});

export async function POST(request: Request) {
  const input = schema.parse(await request.json());
  const invite = await prisma.investorInvite.findUnique({ where: { tokenHash: hashInviteToken(input.token) } });
  if (!invite || invite.status !== "INVITED" || invite.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Invite is invalid or expired" }, { status: 410 });
  }
  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });

  const created = await auth.api.createUser({
    body: {
      email: invite.email,
      password: input.password,
      name: input.name,
      role: "user",
      data: { organizationId: invite.organizationId, systemRole: "INVESTOR" },
    },
  });

  try {
    await prisma.$transaction(async (transaction) => {
      const accepted = await transaction.investorInvite.updateMany({
        where: { id: invite.id, status: "INVITED", acceptedAt: null },
        data: { status: "ACTIVE", acceptedAt: new Date() },
      });
      if (accepted.count !== 1) throw new Error("Invite has already been accepted");
      const profile = await transaction.investorProfile.create({
        data: { userId: created.user.id, displayName: input.name },
      });
      await transaction.investorOrganizationAccess.create({
        data: { investorId: profile.id, organizationId: invite.organizationId, status: "ACTIVE", approvedAt: new Date() },
      });
    });
  } catch (error) {
    await prisma.user.delete({ where: { id: created.user.id } });
    throw error;
  }

  return NextResponse.json({ accepted: true });
}
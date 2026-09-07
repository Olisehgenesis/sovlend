import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  accountNumber: z.string().trim().min(1),
  mobileNumber: z.string().trim().min(1),
});

const invalid = () => NextResponse.json({ error: { message: "Invalid account number or phone number" } }, { status: 401 });

export async function POST(request: Request) {
  const input = schema.parse(await request.json());

  const client = await prisma.client.findFirst({
    where: { accountNumber: input.accountNumber, authUserId: { not: null } },
    select: { authUserId: true },
  });
  if (!client?.authUserId) return invalid();

  const authUser = await prisma.user.findUnique({ where: { id: client.authUserId }, select: { email: true } });
  if (!authUser) return invalid();

  try {
    return await auth.api.signInEmail({
      body: { email: authUser.email, password: input.mobileNumber },
      asResponse: true,
    });
  } catch {
    return invalid();
  }
}

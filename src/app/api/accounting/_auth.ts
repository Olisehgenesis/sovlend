import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function requireSuperAdminForAccountingApi() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const allowedEmails = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (session.user.role !== "admin" || !allowedEmails.includes(session.user.email.toLowerCase())) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });
  if (!user?.organizationId) {
    return {
      error: NextResponse.json({ error: "Super administrator requires an organization" }, { status: 400 }),
    };
  }

  return { organizationId: user.organizationId };
}

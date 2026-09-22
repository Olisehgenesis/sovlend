import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ archived: z.boolean() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === session.user.id) {
    return NextResponse.json({ error: "You cannot archive your own account" }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, systemRole: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.systemRole === "SYSTEM") {
    return NextResponse.json({ error: "System accounts cannot be archived" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: parsed.data.archived
        ? { banned: true, banReason: "Archived by administrator", banExpires: null }
        : { banned: false, banReason: null, banExpires: null },
    }),
    ...(parsed.data.archived ? [prisma.session.deleteMany({ where: { userId: id } })] : []),
  ]);

  return NextResponse.json({ ok: true, archived: parsed.data.archived });
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { loadInvestorAccessScope } from "@/lib/can-manage-investor-access";
import { prisma } from "@/lib/prisma";

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await loadInvestorAccessScope(session);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification || notification.audienceType !== "INVESTOR_APPROVAL") return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  if (!scope.isSuperAdmin && notification.audienceId !== scope.organizationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true });
}

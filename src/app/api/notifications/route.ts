import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { loadInvestorAccessScope } from "@/lib/can-manage-investor-access";
import { prisma } from "@/lib/prisma";

/**
 * In-app notification bell feed. For now the only audience type is INVESTOR_APPROVAL (see
 * notifyInvestorAccessApprovers in api/investor/access/route.ts) -- audienceId is the
 * organizationId of the business the request is for, so branch managers only see requests for
 * their own business while super-admins see every business.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await loadInvestorAccessScope(session);
  if (!scope) return NextResponse.json({ notifications: [], unreadCount: 0 });

  const where = { audienceType: "INVESTOR_APPROVAL", ...(scope.isSuperAdmin ? {} : { audienceId: scope.organizationId }) };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);

  return NextResponse.json({
    unreadCount,
    notifications: notifications.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
  });
}

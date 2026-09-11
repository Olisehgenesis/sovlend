import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { canManageInvestorAccessForOrganization } from "@/lib/can-manage-investor-access";
import { prisma } from "@/lib/prisma";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const access = await prisma.investorOrganizationAccess.findUnique({ where: { id } });
  if (!access) return NextResponse.json({ error: "Access request not found" }, { status: 404 });

  const authorized = await canManageInvestorAccessForOrganization(session, access.organizationId);
  if (!authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const input = schema.parse(await request.json());
  const updated = await prisma.investorOrganizationAccess.update({
    where: { id },
    data:
      input.action === "approve"
        ? { status: "ACTIVE", approvedAt: new Date() }
        : { status: "REJECTED", approvedAt: null },
  });
  await prisma.notification.updateMany({
    where: { deduplicationKey: { startsWith: `investor-access-request:${id}:` }, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ status: updated.status });
}

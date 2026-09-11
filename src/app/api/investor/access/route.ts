import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ organizationId: z.string().uuid() });

/**
 * Logged-in investors request access to a specific business here. This creates (or reopens) an
 * InvestorOrganizationAccess row in REQUESTED status -- the business stays invisible to the
 * investor's dashboard until an admin approves it (see PATCH /api/investor/access/[id]).
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const investor = await prisma.investorProfile.findUnique({ where: { userId: session.user.id } });
  if (!investor) return NextResponse.json({ error: "Investor profile not found" }, { status: 404 });

  const input = schema.parse(await request.json());
  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
  if (!organization) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const existing = await prisma.investorOrganizationAccess.findUnique({
    where: { investorId_organizationId: { investorId: investor.id, organizationId: input.organizationId } },
  });

  if (existing) {
    if (existing.status === "ACTIVE" || existing.status === "REQUESTED" || existing.status === "INVITED") {
      return NextResponse.json({ status: existing.status });
    }
    const updated = await prisma.investorOrganizationAccess.update({
      where: { id: existing.id },
      data: { status: "REQUESTED", approvedAt: null },
    });
    await notifyInvestorAccessApprovers(updated.id, updated.organizationId, investor.displayName);
    return NextResponse.json({ status: updated.status });
  }

  const created = await prisma.investorOrganizationAccess.create({
    data: { investorId: investor.id, organizationId: input.organizationId, status: "REQUESTED" },
  });
  await notifyInvestorAccessApprovers(created.id, created.organizationId, investor.displayName);
  return NextResponse.json({ status: created.status }, { status: 201 });
}

/** Lets branch managers/admins see and act on the request from the notification bell (see
 * NotificationBell in app-header.tsx) instead of having to remember to check
 * /backoffice/investors. audienceId is the business's organizationId so each staff member only
 * sees requests for the business they manage; the deduplication key is prefixed with the
 * access row's id so the approve/reject route can mark it read once it's actioned. */
async function notifyInvestorAccessApprovers(accessId: string, organizationId: string, investorName: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  await prisma.notification.create({
    data: {
      audienceType: "INVESTOR_APPROVAL",
      audienceId: organizationId,
      title: "New investor access request",
      body: `${investorName} requested access to fund ${organization?.name ?? "a business"}.`,
      channels: { inApp: true },
      deduplicationKey: `investor-access-request:${accessId}:${Date.now()}`,
    },
  });
}

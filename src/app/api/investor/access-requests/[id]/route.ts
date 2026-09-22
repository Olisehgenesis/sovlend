import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { canManageInvestorAccessForOrganization } from "@/lib/can-manage-investor-access";
import { prisma } from "@/lib/prisma";
import { approveInvestorLead, rejectInvestorLead } from "@/modules/investments/application/approve-investor-lead";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const lead = await prisma.investorAccessRequest.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Access request not found" }, { status: 404 });

  const authorized = await canManageInvestorAccessForOrganization(session, lead.organizationId);
  if (!authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const input = schema.parse(await request.json());
  try {
    if (input.action === "reject") {
      const result = await rejectInvestorLead(prisma, id);
      return NextResponse.json(result);
    }
    const result = await approveInvestorLead(prisma, { leadId: id, createdById: session.user.id });
    if (result.kind === "invited") {
      const baseUrl = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
      return NextResponse.json({
        kind: result.kind,
        email: result.email,
        inviteUrl: `${baseUrl}/investor/join/${result.token}`,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update this request" }, { status: 409 });
  }
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { approveLoanApplication } from "@/modules/lending/application/approve-loan-application";

const schema = z.object({ approvedPrincipalMinor: z.string().regex(/^\d+$/), reason: z.string().trim().max(1_000).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid approval" }, { status: 400 });
  try {
    const application = await approveLoanApplication(prisma, { applicationId: (await params).id, actorUserId: session.user.id, approvedPrincipalMinor: BigInt(parsed.data.approvedPrincipalMinor), reason: parsed.data.reason });
    return NextResponse.json({ id: application.id, status: application.status });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "Your permission group or approval limit does not allow this approval" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approval failed" }, { status: 400 });
  }
}
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { ScheduleChangeError, rescheduleLoanDates } from "@/modules/lending/application/reschedule-loan-dates";

const schema = z.object({
  reason: z.string().trim().min(3).max(500),
  expectedUpdatedAt: z.iso.datetime(),
  dates: z.array(z.object({
    id: z.uuid(),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1).max(200),
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace required" }, { status: 403 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid loan ID" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid schedule" }, { status: 400 });

  try {
    return NextResponse.json(await rescheduleLoanDates(prisma, scope, {
      loanId: id,
      actorUserId: session.user.id,
      reason: parsed.data.reason,
      expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
      dates: parsed.data.dates,
    }));
  } catch (error) {
    if (error instanceof ScheduleChangeError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot change repayment dates for this loan" }, { status: 403 });
    throw error;
  }
}

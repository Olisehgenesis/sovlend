import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { postProvisioningEntry } from "@/modules/ledger/application/post-provisioning-entry";
import { PeriodClosedError } from "@/modules/ledger/application/assert-period-open";

const schema = z.object({
  officeId: z.string().uuid(),
  asOfDate: z.iso.date(),
  narration: z.string().trim().max(200).optional(),
});

// "Provisioning Entries": posts the change in required loan-loss provision (computed from the
// same PAR-aging ladder as /reports/risk/provisioning) since this office's last posting. Gated
// on the same LEDGER_POST permission as Frequent Postings -- see post-provisioning-entry.ts for
// why only the delta is posted and why postings are idempotent per office+asOfDate.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "No organization for this user" }, { status: 400 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  try {
    const result = await postProvisioningEntry(prisma, {
      organizationId: scope.organizationId,
      officeId: parsed.data.officeId,
      actorUserId: session.user.id,
      asOfDate: new Date(`${parsed.data.asOfDate}T00:00:00.000Z`),
      narration: parsed.data.narration,
    });
    return NextResponse.json({
      alreadyPosted: result.alreadyPosted,
      posting: {
        id: result.posting.id,
        requiredProvisionMinor: result.posting.requiredProvisionMinor.toString(),
        previousProvisionMinor: result.posting.previousProvisionMinor.toString(),
        deltaMinor: result.posting.deltaMinor.toString(),
        journalId: result.posting.journalId,
      },
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "You do not have permission to post accounting entries" }, { status: 403 });
    }
    if (error instanceof PeriodClosedError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Provisioning entry could not be posted" }, { status: 400 });
  }
}

import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({
  officeId: z.string().uuid(),
  externalId: z.string().trim().max(100).optional(),
  name: z.string().trim().min(1).max(150),
  staffId: z.string().trim().max(100).optional(),
  active: z.boolean().default(false),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid group details" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const office = await prisma.office.findFirst({ where: { id: parsed.data.officeId, organizationId: scope.organizationId } });
  if (!office || (scope.officeIds && !scope.officeIds.includes(office.id))) return NextResponse.json({ error: "Office is outside your assigned scope" }, { status: 403 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.clientManage, organizationId: scope.organizationId, officeId: office.id });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot create groups in this office" }, { status: 403 });
    throw error;
  }

  const id = randomUUID();
  const today = new Date();
  const datePrefix = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  const correlationId = randomUUID();
  const group = await prisma.$transaction(async (transaction) => {
    const [organization] = await transaction.$queryRaw<{ nextGroupSequence: number }[]>`UPDATE "Organization" SET "nextGroupSequence" = "nextGroupSequence" + 1 WHERE id = ${scope.organizationId}::uuid RETURNING "nextGroupSequence"`;
    const accountNumber = `G-${datePrefix}-${String(organization.nextGroupSequence).padStart(6, "0")}`;
    const metadata = { officeId: office.id, accountNumber };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "group.created", metadata })).digest("hex");
    const created = await transaction.group.create({
      data: {
        id,
        organizationId: scope.organizationId,
        officeId: office.id,
        accountNumber,
        externalId: parsed.data.externalId || null,
        name: parsed.data.name,
        staffId: parsed.data.staffId || null,
        status: parsed.data.active ? "ACTIVE" : "PENDING",
        submittedOn: today,
        activatedOn: parsed.data.active ? today : null,
      },
    });
    await transaction.auditEvent.create({ data: { actorId: session.user.id, action: "group.created", entityType: "Group", entityId: created.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "Group", aggregateId: created.id, eventType: "group.created", payload: metadata } });
    return created;
  });
  return NextResponse.json({ id: group.id, accountNumber: group.accountNumber }, { status: 201 });
}

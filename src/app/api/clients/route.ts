import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const clientSchema = z.object({
  officeId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(100),
  middleName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().min(1).max(150),
  mobileNumber: z.string().trim().max(30).optional(),
  dateOfBirth: z.iso.date().optional(),
  genderCode: z.string().trim().max(50).optional(),
  clientTypeCode: z.string().trim().max(80).optional(),
  classificationCode: z.string().trim().max(80).optional(),
  externalId: z.string().trim().max(100).optional(),
  active: z.boolean().default(false),
  isStaff: z.boolean().default(false),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = clientSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid client details" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const office = await prisma.office.findFirst({ where: { id: parsed.data.officeId, organizationId: scope.organizationId } });
  if (!office || (scope.officeIds && !scope.officeIds.includes(office.id))) return NextResponse.json({ error: "Office is outside your assigned scope" }, { status: 403 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.clientManage, organizationId: scope.organizationId, officeId: office.id });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot create clients in this office" }, { status: 403 });
    throw error;
  }

  const id = randomUUID();
  const today = new Date();
  const datePrefix = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  const correlationId = randomUUID();
  const client = await prisma.$transaction(async (transaction) => {
    const [organization] = await transaction.$queryRaw<{ nextClientSequence: number }[]>`UPDATE "Organization" SET "nextClientSequence" = "nextClientSequence" + 1 WHERE id = ${scope.organizationId}::uuid RETURNING "nextClientSequence"`;
    const sequence = organization.nextClientSequence;
    const accountNumber = `${datePrefix}${String(sequence).padStart(6, "0")}`;
    const metadata = { officeId: office.id, accountNumber };
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "client.created", metadata })).digest("hex");
    const created = await transaction.client.create({
      data: {
        id,
        organizationId: scope.organizationId,
        officeId: office.id,
        accountNumber,
        firstName: parsed.data.firstName,
        middleName: parsed.data.middleName || null,
        lastName: parsed.data.lastName,
        mobileNumber: parsed.data.mobileNumber || null,
        dateOfBirth: parsed.data.dateOfBirth ? new Date(`${parsed.data.dateOfBirth}T00:00:00.000Z`) : null,
        genderCode: parsed.data.genderCode || null,
        clientTypeCode: parsed.data.clientTypeCode || null,
        classificationCode: parsed.data.classificationCode || null,
        externalId: parsed.data.externalId || null,
        isStaff: parsed.data.isStaff,
        status: parsed.data.active ? "ACTIVE" : "SUBMITTED",
        submittedOn: new Date(),
        activatedOn: parsed.data.active ? new Date() : null,
      },
    });
    await transaction.auditEvent.create({ data: { actorId: session.user.id, action: "client.created", entityType: "Client", entityId: created.id, correlationId, metadata, eventHash } });
    await transaction.outboxEvent.create({ data: { aggregateType: "Client", aggregateId: created.id, eventType: "client.created", payload: metadata } });
    await transaction.savingsAccount.create({ data: { clientId: created.id, accountNumber: created.accountNumber, currencyCode: "UGX", status: "ACTIVE" } });
    return created;
  });
  return NextResponse.json({ id: client.id, accountNumber: client.accountNumber }, { status: 201 });
}
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  middleName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().min(1).max(150),
  mobileNumber: z.string().trim().max(30).optional(),
  dateOfBirth: z.iso.date().optional(),
  genderCode: z.string().trim().max(50).optional(),
  clientTypeCode: z.string().trim().max(80).optional(),
  classificationCode: z.string().trim().max(80).optional(),
  externalId: z.string().trim().max(100).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid client details" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const client = await prisma.client.findFirst({ where: { id, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.clientManage, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot edit this client" }, { status: 403 });
    throw error;
  }

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: {
      firstName: parsed.data.firstName,
      middleName: parsed.data.middleName || null,
      lastName: parsed.data.lastName,
      mobileNumber: parsed.data.mobileNumber || null,
      dateOfBirth: parsed.data.dateOfBirth ? new Date(`${parsed.data.dateOfBirth}T00:00:00.000Z`) : null,
      genderCode: parsed.data.genderCode || null,
      clientTypeCode: parsed.data.clientTypeCode || null,
      classificationCode: parsed.data.classificationCode || null,
      externalId: parsed.data.externalId || null,
    },
  });
  return NextResponse.json({ id: updated.id, accountNumber: updated.accountNumber });
}

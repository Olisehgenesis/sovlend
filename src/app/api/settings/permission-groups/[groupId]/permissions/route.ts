import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ permissionCode: z.string().trim().min(1) });

async function resolveAdminOrganization() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!actor?.organizationId) return { error: NextResponse.json({ error: "Administrator requires an organization" }, { status: 400 }) };

  return { organizationId: actor.organizationId };
}

async function validateTargets(groupId: string, permissionCode: string, organizationId: string) {
  const [group, permission] = await Promise.all([
    prisma.permissionGroup.findFirst({ where: { id: groupId, organizationId }, select: { id: true, name: true } }),
    prisma.permissionDefinition.findUnique({ where: { code: permissionCode }, select: { code: true } }),
  ]);
  if (!group) return { error: NextResponse.json({ error: "Permission group not found" }, { status: 404 }) };
  if (!permission) return { error: NextResponse.json({ error: "Permission definition not found" }, { status: 404 }) };
  return { group };
}

export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const admin = await resolveAdminOrganization();
  if ("error" in admin) return admin.error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { groupId } = await params;
  const validated = await validateTargets(groupId, parsed.data.permissionCode, admin.organizationId);
  if ("error" in validated) return validated.error;

  await prisma.permissionGroupPermission.upsert({
    where: { groupId_permissionCode: { groupId, permissionCode: parsed.data.permissionCode } },
    create: { groupId, permissionCode: parsed.data.permissionCode },
    update: {},
  });

  return NextResponse.json({ ok: true, groupId, permissionCode: parsed.data.permissionCode });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const admin = await resolveAdminOrganization();
  if ("error" in admin) return admin.error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { groupId } = await params;
  const validated = await validateTargets(groupId, parsed.data.permissionCode, admin.organizationId);
  if ("error" in validated) return validated.error;

  await prisma.permissionGroupPermission.deleteMany({ where: { groupId, permissionCode: parsed.data.permissionCode } });

  return NextResponse.json({ ok: true, groupId, permissionCode: parsed.data.permissionCode });
}

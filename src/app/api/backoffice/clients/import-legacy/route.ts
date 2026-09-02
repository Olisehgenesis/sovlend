import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReadOnlyFineractClient } from "@/migration/fineract-client";
import { importLegacyClient } from "@/migration/import-client";

const schema = z.object({ legacyClientId: z.number().int().positive(), officeId: z.string().uuid() });

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const allowedEmails = (process.env.SUPER_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!session || session.user.role !== "admin" || !allowedEmails.includes(session.user.email.toLowerCase())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const { LEGACY_BASE_URL, LEGACY_TENANT_ID, LEGACY_USERNAME, LEGACY_PASSWORD } = process.env;
  if (!LEGACY_BASE_URL || !LEGACY_TENANT_ID || !LEGACY_USERNAME || !LEGACY_PASSWORD) return NextResponse.json({ error: "Legacy system credentials are not configured" }, { status: 503 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user?.organizationId) return NextResponse.json({ error: "Super administrator requires an organization" }, { status: 403 });
  const office = await prisma.office.findFirst({ where: { id: parsed.data.officeId, organizationId: user.organizationId } });
  if (!office) return NextResponse.json({ error: "Office is outside your organization" }, { status: 403 });

  try {
    const fineract = new ReadOnlyFineractClient(LEGACY_BASE_URL, LEGACY_TENANT_ID, LEGACY_USERNAME, LEGACY_PASSWORD);
    const result = await importLegacyClient(prisma, fineract, { legacyClientId: parsed.data.legacyClientId, organizationId: user.organizationId, officeId: office.id, actorUserId: session.user.id });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed" }, { status: 502 });
  }
}

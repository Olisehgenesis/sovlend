import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { addApplicationGuarantor, applicationGuarantorSchema, ApplicationGuarantorError } from "@/modules/lending/application/application-guarantors";

async function save(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid application ID" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = applicationGuarantorSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid guarantor" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  try {
    const profileId = new URL(request.url).searchParams.get("profileId") ?? undefined;
    if (request.method === "PATCH" && !z.uuid().safeParse(profileId).success) return NextResponse.json({ error: "Invalid guarantor ID" }, { status: 400 });
    const savedId = await addApplicationGuarantor(prisma, scope, { applicationId: id, actorUserId: session.user.id, guarantor: parsed.data, profileId: request.method === "PATCH" ? profileId : undefined });
    return NextResponse.json({ ok: true, id: savedId }, { status: request.method === "PATCH" ? 200 : 201 });
  } catch (error) {
    if (error instanceof ApplicationGuarantorError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot add guarantors to this application" }, { status: 403 });
    throw error;
  }

}

export const POST = save;
export const PATCH = save;

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { exportFormats, exportScopeTypes, requestLoanExport } from "@/modules/lending/application/export-loans";

const createSchema = z.object({
  scopeType: z.enum(exportScopeTypes),
  scopeParams: z.record(z.string(), z.unknown()).optional(),
  format: z.enum(exportFormats),
  asOfDate: z.iso.date().optional(),
  idempotencyKey: z.string().uuid(),
});

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const jobs = await prisma.loanExportJob.findMany({
    where: { organizationId: scope.organizationId, requestedById: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    jobs: jobs.map((job) => ({
      id: job.id,
      scopeType: job.scopeType,
      scopeParams: job.scopeParams,
      format: job.format,
      status: job.status,
      asOfDate: job.asOfDate.toISOString().slice(0, 10),
      manifest: job.manifest,
      resultByteSize: job.resultByteSize,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid export request" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  try {
    const job = await requestLoanExport(prisma, {
      actorUserId: session.user.id,
      organizationId: scope.organizationId,
      officeIds: scope.officeIds,
      scopeType: parsed.data.scopeType,
      scopeParams: parsed.data.scopeParams ?? {},
      format: parsed.data.format,
      asOfDate: parsed.data.asOfDate ? new Date(`${parsed.data.asOfDate}T00:00:00.000Z`) : new Date(),
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ id: job.id, status: job.status }, { status: 201 });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You do not have permission to export loans" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Export request failed" }, { status: 400 });
  }
}

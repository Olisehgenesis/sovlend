import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope } from "@/modules/identity/application/data-scope";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const job = await prisma.loanExportJob.findFirst({
    where: { id: (await params).jobId, organizationId: scope.organizationId, requestedById: session.user.id },
  });
  if (!job) return NextResponse.json({ error: "Export job not found" }, { status: 404 });

  return NextResponse.json({
    id: job.id,
    scopeType: job.scopeType,
    scopeParams: job.scopeParams,
    format: job.format,
    status: job.status,
    asOfDate: job.asOfDate.toISOString().slice(0, 10),
    manifest: job.manifest,
    resultByteSize: job.resultByteSize,
    resultSha256: job.resultSha256,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  });
}

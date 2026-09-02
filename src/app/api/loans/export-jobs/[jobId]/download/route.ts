import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { readLoanExportPackage } from "@/modules/lending/application/export-loans";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const job = await prisma.loanExportJob.findFirst({
    where: { id: (await params).jobId, organizationId: scope.organizationId, requestedById: session.user.id },
  });
  if (!job) return NextResponse.json({ error: "Export job not found" }, { status: 404 });
  if (job.status !== "COMPLETED" || !job.resultObjectKey) {
    return NextResponse.json({ error: `Export is not ready (status: ${job.status})` }, { status: 409 });
  }

  const bytes = await readLoanExportPackage(job.resultObjectKey);
  const extension = job.format === "JSON" ? "json" : "zip";
  const contentType = job.format === "JSON" ? "application/json" : "application/zip";
  const filename = `sovlend-loan-export-${job.asOfDate.toISOString().slice(0, 10)}-${job.id.slice(0, 8)}.${extension}`;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

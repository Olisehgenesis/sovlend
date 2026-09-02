import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { readDocumentBytes } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const inOfficeScope = officeWhere(scope);
  const document = await prisma.document.findFirst({
    where: {
      id,
      OR: [
        { client: { organizationId: scope.organizationId, ...inOfficeScope } },
        { loan: { office: { organizationId: scope.organizationId }, ...inOfficeScope } },
      ],
    },
  });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  try {
    const bytes = await readDocumentBytes(document.objectKey);
    const disposition = document.mediaType.startsWith("image/") ? "inline" : "attachment";
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": document.mediaType, "Content-Disposition": `${disposition}; filename="${document.name.replaceAll('"', "")}"` } });
  } catch {
    return NextResponse.json({ error: "Stored file is missing" }, { status: 404 });
  }
}

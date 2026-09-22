import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { InvestorAccessRequest } from "@/components/investor-access-request";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureInvestorWorkspace } from "@/modules/investments/application/ensure-investor-workspace";

export const dynamic = "force-dynamic";

export default async function InvestorAccessRequestPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true },
    });
    if (user) {
      await ensureInvestorWorkspace(prisma, user);
      redirect("/investor");
    }
  }

  const organizations = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <InvestorAccessRequest organizations={organizations} />;
}

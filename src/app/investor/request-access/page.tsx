import { InvestorAccessRequest } from "@/components/investor-access-request";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function InvestorAccessRequestPage() {
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <InvestorAccessRequest organizations={organizations} />;
}
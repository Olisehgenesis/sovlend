import { InvestorSignInForm } from "@/components/investor-sign-in-form";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function InvestorSignInPage() {
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <InvestorSignInForm organizations={organizations} />;
}

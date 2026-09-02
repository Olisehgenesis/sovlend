import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminUsersPanel } from "@/components/admin-users-panel";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AdminUsersPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, systemRole: true, banned: true, organization: { select: { name: true } }, office: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 100,
  });
  const [organizations, offices] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.office.findMany({ select: { id: true, name: true, organizationId: true }, orderBy: { name: "asc" } }),
  ]);

  return <AdminUsersPanel initialUsers={users.map(({ organization, office, ...user }) => ({ ...user, systemRole: user.systemRole, organizationName: organization?.name ?? null, officeName: office?.name ?? null }))} organizations={organizations} offices={offices} />;
}
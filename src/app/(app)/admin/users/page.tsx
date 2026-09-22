import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminUsersPanel } from "@/components/admin-users-panel";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_SYSTEM_ROLES } from "@/modules/identity/domain/staff-roles";

const activeLoanStatuses = ["ACTIVE", "IN_ARREARS"] as const;

export default async function AdminUsersPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  const [users, officerCounts, clientCounts, organizations, offices] = await Promise.all([
    prisma.user.findMany({
      where: { systemRole: { not: "SYSTEM" } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        systemRole: true,
        banned: true,
        mobileNumber: true,
        genderCode: true,
        joinedOn: true,
        organization: { select: { name: true } },
        office: { select: { name: true } },
        clientProfile: { select: { id: true } },
      },
    }),
    prisma.loan.groupBy({
      by: ["loanOfficerId"],
      where: { status: { in: [...activeLoanStatuses] }, loanOfficerId: { not: null } },
      _count: { _all: true },
    }),
    prisma.loan.groupBy({
      by: ["clientId"],
      where: { status: { in: [...activeLoanStatuses] }, clientId: { not: null } },
      _count: { _all: true },
    }),
    prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.office.findMany({ select: { id: true, name: true, organizationId: true }, orderBy: { name: "asc" } }),
  ]);

  const loansByOfficer = new Map(
    officerCounts.flatMap((row) => (row.loanOfficerId ? [[row.loanOfficerId, row._count._all] as const] : [])),
  );
  const loansByClient = new Map(
    clientCounts.flatMap((row) => (row.clientId ? [[row.clientId, row._count._all] as const] : [])),
  );

  const staffRole = new Set<string>(STAFF_SYSTEM_ROLES);
  const initialUsers = users
    .map(({ organization, office, clientProfile, joinedOn, ...user }) => ({
      ...user,
      organizationName: organization?.name ?? null,
      officeName: office?.name ?? null,
      joinedOn: joinedOn ? joinedOn.toISOString() : null,
      activeLoanCount: staffRole.has(user.systemRole ?? "")
        ? (loansByOfficer.get(user.id) ?? 0)
        : (clientProfile ? loansByClient.get(clientProfile.id) ?? 0 : 0),
    }))
    .sort((left, right) => {
      const leftStaff = staffRole.has(left.systemRole ?? "") ? 0 : 1;
      const rightStaff = staffRole.has(right.systemRole ?? "") ? 0 : 1;
      if (leftStaff !== rightStaff) return leftStaff - rightStaff;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

  return (
    <AdminUsersPanel
      currentUserId={session.user.id}
      initialUsers={initialUsers}
      organizations={organizations}
      offices={offices}
    />
  );
}

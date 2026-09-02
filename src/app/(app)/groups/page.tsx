import { Network, UsersRound } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";

export default async function GroupsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const groups = await prisma.group.findMany({
    where: { organizationId: scope.organizationId, ...officeWhere(scope) },
    include: { office: { select: { name: true } }, assignedOfficer: { select: { name: true } }, _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="directory-page">
      <header className="directory-header">
        <div><p className="eyebrow">Group lending</p><h1>Groups &amp; centers</h1><p>{groups.length.toLocaleString()} groups in your office scope</p></div>
        <Link className="invest-button" href="/groups/new"><UsersRound size={16} /> Create group</Link>
      </header>
      {groups.length === 0 ? <div className="empty-state"><Network size={28} /><strong>No groups yet</strong><p>Create a group to organize clients who borrow or save together.</p></div> : <section className="panel"><div className="table-scroll"><table className="clickable-rows"><thead><tr><th>Group</th><th>Account</th><th>Office</th><th>Staff</th><th>Members</th><th>Status</th></tr></thead><tbody>{groups.map((group) => <tr key={group.id}><td><strong>{group.name}</strong><Link className="row-link" href={`/groups/${group.accountNumber}`} /></td><td className="mono">{group.accountNumber}</td><td>{group.office.name}</td><td>{group.assignedOfficer?.name ?? "Unassigned"}</td><td>{group._count.members}</td><td><span className={`status ${group.status === "ACTIVE" ? "up-to-date" : "review"}`}>{group.status}</span></td></tr>)}</tbody></table></div></section>}
    </main>
  );
}

import { CircleUserRound, StickyNote, Users } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { AddGroupMemberForm, AddGroupNoteForm } from "@/components/group-record-forms";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";

const tabs = [
  { key: "general", label: "General", icon: CircleUserRound },
  { key: "members", label: "Members", icon: Users },
  { key: "notes", label: "Notes", icon: StickyNote },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export default async function GroupDetailPage({ params, searchParams }: { params: Promise<{ accountNumber: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const { accountNumber } = await params;
  const tab = (await searchParams).tab as TabKey | undefined;
  const activeTab: TabKey = tabs.some((item) => item.key === tab) ? (tab as TabKey) : "general";

  const group = await prisma.group.findFirst({
    where: { accountNumber, organizationId: scope.organizationId, ...officeWhere(scope) },
    include: {
      office: { select: { name: true } },
      assignedOfficer: { select: { name: true } },
      members: { orderBy: { createdAt: "desc" }, include: { client: { select: { accountNumber: true, firstName: true, middleName: true, lastName: true, status: true } } } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!group) notFound();

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Groups", href: "/groups" }, { label: group.name }]} />
      <header className="client-header">
        <span className={`status-dot ${group.status === "ACTIVE" ? "up-to-date" : "review"}`} />
        <div>
          <h1>{group.name}</h1>
          <p>Account #: <span className="mono">{group.accountNumber}</span> | Office: {group.office.name} | Staff: {group.assignedOfficer?.name ?? "Unassigned"}</p>
        </div>
      </header>

      <nav className="client-tabs" aria-label="Group record sections">
        {tabs.map((item) => { const Icon = item.icon; return <Link className={activeTab === item.key ? "active" : ""} href={`/groups/${group.accountNumber}?tab=${item.key}`} key={item.key}><Icon size={15} />{item.label}</Link>; })}
      </nav>

      {activeTab === "general" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>General information</h2><p>A group has no shared account balance &mdash; it only tracks who borrows or saves together</p></div></div>
          <dl className="detail-grid">
            <div><dt>Office</dt><dd>{group.office.name}</dd></div>
            <div><dt>Status</dt><dd><span className={`status ${group.status === "ACTIVE" ? "up-to-date" : "review"}`}>{group.status}</span></dd></div>
            <div><dt>External ID</dt><dd>{group.externalId ?? "None"}</dd></div>
            <div><dt>Staff</dt><dd>{group.assignedOfficer?.name ?? "Unassigned"}</dd></div>
            <div><dt>Submitted on</dt><dd>{group.submittedOn ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(group.submittedOn) : "\u2014"}</dd></div>
            <div><dt>Activation date</dt><dd>{group.activatedOn ? new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(group.activatedOn) : "Not activated"}</dd></div>
            <div><dt>Active members</dt><dd>{group.members.length}</dd></div>
          </dl>
        </section>
      ) : null}

      {activeTab === "members" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Members</h2><p>Clients who borrow or save through this group</p></div></div>
          {group.members.length === 0 ? <div className="empty-state compact-empty"><Users size={26} /><strong>No members yet</strong><p>Add a client by account number below.</p></div> : <div className="table-scroll"><table className="clickable-rows"><thead><tr><th>Account #</th><th>Name</th><th>Status</th></tr></thead><tbody>{group.members.map((member) => <tr key={member.id}><td className="mono">{member.client.accountNumber}</td><td><strong>{[member.client.firstName, member.client.middleName, member.client.lastName].filter(Boolean).join(" ")}</strong><Link className="row-link" href={`/clients/${member.client.accountNumber}`} /></td><td><span className={`status ${member.client.status === "ACTIVE" ? "up-to-date" : "review"}`}>{member.client.status}</span></td></tr>)}</tbody></table></div>}
          <AddGroupMemberForm groupId={group.id} />
        </section>
      ) : null}

      {activeTab === "notes" ? (
        <section className="panel">
          <div className="panel-heading"><div><h2>Notes</h2><p>Internal notes visible to your office</p></div></div>
          {group.notes.length === 0 ? <div className="empty-state compact-empty"><StickyNote size={26} /><strong>No notes yet</strong><p>Leave context for other staff working with this group.</p></div> : <ul className="note-list">{group.notes.map((note) => <li key={note.id}><p>{note.body}</p><small>{note.author.name} \u00b7 {new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(note.createdAt)}</small></li>)}</ul>}
          <AddGroupNoteForm groupId={group.id} />
        </section>
      ) : null}
    </main>
  );
}

import { Network, UsersRound } from "lucide-react";
import type { GroupStatus, Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveSearchInput } from "@/components/live-search-input";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, groupScopeWhere } from "@/modules/identity/application/data-scope";

const supportedStatusFilters = ["PENDING", "ACTIVE", "CLOSED"] as const;

type SupportedGroupStatusFilter = (typeof supportedStatusFilters)[number];

const statusAliasToValue: Record<string, GroupStatus> = {
  active: "ACTIVE",
  closed: "CLOSED",
  pending: "PENDING",
  submitted: "PENDING",
};

const groupStatusFilterMeta: Record<
  SupportedGroupStatusFilter,
  {
    heading: string;
    countLabel: string;
    emptyTitle: string;
    emptyDescription: string;
    tone: string;
  }
> = {
  PENDING: {
    heading: "Pending",
    countLabel: "pending groups",
    emptyTitle: "No pending groups match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
  ACTIVE: {
    heading: "Active",
    countLabel: "active groups",
    emptyTitle: "No active groups match",
    emptyDescription: "Change the filter and try again.",
    tone: "up-to-date",
  },
  CLOSED: {
    heading: "Closed",
    countLabel: "closed groups",
    emptyTitle: "No closed groups match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
};

const pageSize = 25;

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string; status?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");

  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const requestedStatus = parseGroupStatusFilter(params.status);
  const activeStatusMeta = requestedStatus ? groupStatusFilterMeta[requestedStatus] : null;
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const searchFilters: Prisma.GroupWhereInput[] = [];
  if (query) {
    const normalized = query.toLowerCase();
    const status = statusAliasToValue[normalized];
    if (status) searchFilters.push({ status });
    searchFilters.push({ name: { contains: query, mode: "insensitive" } });
    searchFilters.push({ accountNumber: { contains: query } });
    searchFilters.push({ office: { name: { contains: query, mode: "insensitive" } } });
    searchFilters.push({ assignedOfficer: { is: { name: { contains: query, mode: "insensitive" } } } });
  }

  const where: Prisma.GroupWhereInput = {
    organizationId: scope.organizationId,
    ...groupScopeWhere(scope),
    ...(requestedStatus ? { status: requestedStatus } : {}),
    ...(searchFilters.length > 0 ? { AND: [{ OR: searchFilters }] } : {}),
  };

  const total = await prisma.group.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pages);
  const groups = await prisma.group.findMany({
    where,
    include: {
      office: { select: { name: true } },
      assignedOfficer: { select: { name: true } },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const clearStatusHref = query ? `/groups?query=${encodeURIComponent(query)}` : "/groups";
  const pageHref = (targetPage: number) => {
    const nextParams = new URLSearchParams();
    if (query) nextParams.set("query", query);
    if (requestedStatus) nextParams.set("status", requestedStatus);
    nextParams.set("page", String(targetPage));
    return `/groups?${nextParams.toString()}`;
  };
  const statusFilterHref = (status: SupportedGroupStatusFilter) => {
    const nextParams = new URLSearchParams();
    if (query) nextParams.set("query", query);
    nextParams.set("status", status);
    return `/groups?${nextParams.toString()}`;
  };
  const pageWindow = paginateWindow(page, pages);

  return (
    <main className="directory-page">
      <header className="directory-header">
        <div>
          <p className="eyebrow">Group lending</p>
          <h1>{activeStatusMeta ? `Groups & centers — ${activeStatusMeta.heading}` : "Groups & centers"}</h1>
          <p>
            {activeStatusMeta
              ? `${total.toLocaleString()} ${activeStatusMeta.countLabel}`
              : `${total.toLocaleString()} groups in your office scope`}
          </p>
        </div>
        <Link className="invest-button" href="/groups/new">
          <UsersRound size={16} /> Create group
        </Link>
      </header>
      <div className="directory-toolbar">
        <LiveSearchInput placeholder="Search group, account, office or staff" />
        <div className="directory-filter-chip">
          <span className="muted-text">Status:</span>
          {supportedStatusFilters.map((status) => {
            const statusMeta = groupStatusFilterMeta[status];
            return (
              <Link
                aria-current={requestedStatus === status ? "page" : undefined}
                className={`status ${requestedStatus === status ? statusMeta.tone : "review"}`}
                href={statusFilterHref(status)}
                key={status}
              >
                {statusMeta.heading}
              </Link>
            );
          })}
          {activeStatusMeta ? (
            <Link className="green-link" href={clearStatusHref}>
              Clear filter
            </Link>
          ) : null}
        </div>
      </div>
      <section className="panel">
        {groups.length === 0 ? (
          <div className="empty-state">
            <Network size={28} />
            <strong>
              {activeStatusMeta ? activeStatusMeta.emptyTitle : query ? "No matching groups" : "No groups yet"}
            </strong>
            <p>
              {activeStatusMeta
                ? activeStatusMeta.emptyDescription
                : query
                  ? "Change the search and try again."
                  : "Create a group to organize clients who borrow or save together."}
            </p>
            <Link className="invest-button empty-action" href={query || activeStatusMeta ? "/groups" : "/groups/new"}>
              {query || activeStatusMeta ? "Show all groups" : "Create group"}
            </Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="clickable-rows">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Account</th>
                  <th>Office</th>
                  <th>Staff</th>
                  <th>Members</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <strong>{group.name}</strong>
                      <Link className="row-link" href={`/groups/${group.accountNumber}`} />
                    </td>
                    <td className="mono">{group.accountNumber}</td>
                    <td>{group.office.name}</td>
                    <td>{group.assignedOfficer?.name ?? "Unassigned"}</td>
                    <td>{group._count.members}</td>
                    <td>
                      <span className={`status ${groupStatusTone(group.status)}`}>{group.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav className="pagination" aria-label="Group pages">
          <Link aria-disabled={page <= 1} href={pageHref(1)}>
            {"<<"}
          </Link>
          <Link aria-disabled={page <= 1} href={pageHref(Math.max(1, page - 1))}>
            {"<"}
          </Link>
          {pageWindow.map((item) => (
            <Link aria-current={item === page ? "page" : undefined} href={pageHref(item)} key={item}>
              {item}
            </Link>
          ))}
          <Link aria-disabled={page >= pages} href={pageHref(Math.min(pages, page + 1))}>
            {">"}
          </Link>
          <Link aria-disabled={page >= pages} href={pageHref(pages)}>
            {">>"}
          </Link>
        </nav>
      </section>
    </main>
  );
}

function parseGroupStatusFilter(status?: string): SupportedGroupStatusFilter | null {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) return null;
  return supportedStatusFilters.find((value) => value === normalized) ?? null;
}

function groupStatusTone(status: GroupStatus) {
  return status === "ACTIVE" ? "up-to-date" : "review";
}

function paginateWindow(page: number, totalPages: number) {
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  const pages: number[] = [];

  for (let current = start; current <= end; current += 1) {
    pages.push(current);
  }

  return pages;
}

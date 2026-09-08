import { Download, UserPlus, Users } from "lucide-react";
import type { ClientStatus, Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveSearchInput } from "@/components/live-search-input";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientScopeWhere, getUserDataScope } from "@/modules/identity/application/data-scope";

const supportedStatusFilters = [
  "ACTIVE",
  "SUBMITTED",
  "INACTIVE",
  "BLOCKED",
  "CLOSED",
  "REJECTED",
  "DRAFT",
] as const;

type SupportedClientStatusFilter = (typeof supportedStatusFilters)[number];

const statusAliasToValue: Record<string, ClientStatus> = {
  active: "ACTIVE",
  blocked: "BLOCKED",
  closed: "CLOSED",
  draft: "DRAFT",
  inactive: "INACTIVE",
  rejected: "REJECTED",
  submitted: "SUBMITTED",
  pending: "SUBMITTED",
  "pending approval": "SUBMITTED",
};

const clientStatusFilterMeta: Record<
  SupportedClientStatusFilter,
  {
    heading: string;
    countLabel: string;
    emptyTitle: string;
    emptyDescription: string;
    tone: string;
  }
> = {
  ACTIVE: {
    heading: "Active",
    countLabel: "active client records",
    emptyTitle: "No active clients match",
    emptyDescription: "Change the filter and try again.",
    tone: "up-to-date",
  },
  SUBMITTED: {
    heading: "Pending approval",
    countLabel: "submitted client records",
    emptyTitle: "No submitted clients match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
  INACTIVE: {
    heading: "Inactive",
    countLabel: "inactive client records",
    emptyTitle: "No inactive clients match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
  BLOCKED: {
    heading: "Blocked",
    countLabel: "blocked client records",
    emptyTitle: "No blocked clients match",
    emptyDescription: "Change the filter and try again.",
    tone: "in-arrears",
  },
  CLOSED: {
    heading: "Closed",
    countLabel: "closed client records",
    emptyTitle: "No closed clients match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
  REJECTED: {
    heading: "Rejected",
    countLabel: "rejected client records",
    emptyTitle: "No rejected clients match",
    emptyDescription: "Change the filter and try again.",
    tone: "in-arrears",
  },
  DRAFT: {
    heading: "Draft",
    countLabel: "draft client records",
    emptyTitle: "No draft clients match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
};

const pageSize = 25;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string; status?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const userScope = await getUserDataScope(prisma, session.user.id);
  if (!userScope) redirect("/");

  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const requestedStatus = parseClientStatusFilter(params.status);
  const activeStatusMeta = requestedStatus ? clientStatusFilterMeta[requestedStatus] : null;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const scope: Prisma.ClientWhereInput = {
    organizationId: userScope.organizationId,
    ...clientScopeWhere(userScope),
  };

  const searchFilters: Prisma.ClientWhereInput[] = [];
  if (query) {
    const normalized = query.toLowerCase();
    const status = statusAliasToValue[normalized];
    if (status) searchFilters.push({ status });
    searchFilters.push({ firstName: { contains: query, mode: "insensitive" } });
    searchFilters.push({ lastName: { contains: query, mode: "insensitive" } });
    searchFilters.push({ accountNumber: { contains: query } });
    searchFilters.push({ mobileNumber: { contains: query } });
    searchFilters.push({ office: { name: { contains: query, mode: "insensitive" } } });
  }

  const where: Prisma.ClientWhereInput = {
    ...scope,
    ...(requestedStatus ? { status: requestedStatus } : {}),
    ...(searchFilters.length > 0 ? { AND: [{ OR: searchFilters }] } : {}),
  };

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      include: { office: { select: { name: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.client.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const clearStatusHref = query ? `/clients?query=${encodeURIComponent(query)}` : "/clients";
  const pageHref = (targetPage: number) => {
    const nextParams = new URLSearchParams();
    if (query) nextParams.set("query", query);
    if (requestedStatus) nextParams.set("status", requestedStatus);
    nextParams.set("page", String(targetPage));
    return `/clients?${nextParams.toString()}`;
  };
  const statusFilterHref = (status: SupportedClientStatusFilter) => {
    const nextParams = new URLSearchParams();
    if (query) nextParams.set("query", query);
    nextParams.set("status", status);
    return `/clients?${nextParams.toString()}`;
  };

  return (
    <main className="directory-page">
      <header className="directory-header">
        <div>
          <p className="eyebrow">Customer directory</p>
          <h1>{activeStatusMeta ? `Clients — ${activeStatusMeta.heading}` : "Clients"}</h1>
          <p>
            {activeStatusMeta
              ? `${total.toLocaleString()} ${activeStatusMeta.countLabel}`
              : `${total.toLocaleString()} records in your office scope`}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/">
            <span>Overview</span>
          </Link>
          <a className="secondary-action" href="/api/clients/export">
            <Download size={16} /> Export CSV
          </a>
          <Link className="invest-button" href="/clients/new">
            <UserPlus size={16} /> Create client
          </Link>
        </div>
      </header>
      <div className="directory-toolbar">
        <LiveSearchInput placeholder="Search name, account, mobile or office" />
        <div className="directory-filter-chip">
          <span className="muted-text">Status:</span>
          {supportedStatusFilters.map((status) => {
            const statusMeta = clientStatusFilterMeta[status];
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
        <div className="table-scroll">
          <table className="clickable-rows">
            <thead>
              <tr>
                <th>#</th>
                <th>Client</th>
                <th>Account</th>
                <th>Mobile</th>
                <th>Office</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client, index) => (
                <tr key={client.id}>
                  <td className="mono muted-text">{(page - 1) * pageSize + index + 1}</td>
                  <td>
                    <strong>{[client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ")}</strong>
                    <Link
                      aria-label={`Open ${[client.firstName, client.lastName].filter(Boolean).join(" ")}`}
                      className="row-link"
                      href={`/clients/${client.accountNumber}`}
                    />
                  </td>
                  <td className="mono">{client.accountNumber}</td>
                  <td>{client.mobileNumber ?? "Not provided"}</td>
                  <td>{client.office.name}</td>
                  <td>
                    <span className={`status ${clientStatusTone(client.status)}`}>{client.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {clients.length === 0 ? (
          <div className="empty-state">
            <Users size={28} />
            <strong>
              {activeStatusMeta ? activeStatusMeta.emptyTitle : query ? "No matching clients" : "No clients yet"}
            </strong>
            <p>
              {activeStatusMeta
                ? activeStatusMeta.emptyDescription
                : query
                  ? "Change the search and try again."
                  : "Create your first client record to start opening savings accounts, recording documents, and applying for loans."}
            </p>
            <Link className="invest-button empty-action" href={query || activeStatusMeta ? "/clients" : "/clients/new"}>
              {query || activeStatusMeta ? "Show all clients" : "Create client"}
            </Link>
          </div>
        ) : null}
        <nav className="pagination" aria-label="Client pages">
          <Link aria-disabled={page <= 1} href={pageHref(Math.max(1, page - 1))}>
            Previous
          </Link>
          <span>
            Page {page} of {pages}
          </span>
          <Link aria-disabled={page >= pages} href={pageHref(Math.min(pages, page + 1))}>
            Next
          </Link>
        </nav>
      </section>
    </main>
  );
}

function parseClientStatusFilter(status?: string): SupportedClientStatusFilter | null {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) return null;
  return supportedStatusFilters.find((value) => value === normalized) ?? null;
}

function clientStatusTone(status: ClientStatus) {
  switch (status) {
    case "ACTIVE":
      return "up-to-date";
    case "BLOCKED":
    case "REJECTED":
      return "in-arrears";
    default:
      return "review";
  }
}

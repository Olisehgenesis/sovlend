import { PiggyBank } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { LiveSearchInput } from "@/components/live-search-input";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientScopeWhere, getUserDataScope, groupScopeWhere } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

const pageSize = 25;
const supportedStatusFilters = ["SUBMITTED", "APPROVED", "ACTIVE", "INACTIVE", "BLOCKED", "CLOSED", "REJECTED"] as const;

type SupportedSavingsStatusFilter = (typeof supportedStatusFilters)[number];

function fullName(person: { firstName: string; middleName: string | null; lastName: string }) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ");
}

function statusTone(status: string) {
  return status === "ACTIVE" ? "up-to-date" : status === "BLOCKED" ? "in-arrears" : "review";
}

function statusLabel(status: string) {
  return status === "SUBMITTED" ? "Pending approval" : status.replaceAll("_", " ");
}

function accountTypeLabel(accountType: string) {
  return accountType.replaceAll("_", " ");
}

function snapshotRecord(snapshot: Prisma.JsonValue | null) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot as Record<string, Prisma.JsonValue>;
}

function snapshotString(snapshot: Prisma.JsonValue | null, key: string) {
  const value = snapshotRecord(snapshot)?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const accountTypeAliasToValue: Record<string, string> = {
  savings: "SAVINGS",
  share: "SHARE",
  shares: "SHARE",
  "fixed deposit": "FIXED_DEPOSIT",
  fixeddeposit: "FIXED_DEPOSIT",
  "recurring deposit": "RECURRING_DEPOSIT",
  recurringdeposit: "RECURRING_DEPOSIT",
};

const statusAliasToValue: Record<string, SupportedSavingsStatusFilter> = {
  active: "ACTIVE",
  submitted: "SUBMITTED",
  pending: "SUBMITTED",
  "pending approval": "SUBMITTED",
  approved: "APPROVED",
  inactive: "INACTIVE",
  closed: "CLOSED",
  rejected: "REJECTED",
  blocked: "BLOCKED",
};

const savingsStatusFilterMeta: Record<
  SupportedSavingsStatusFilter,
  {
    heading: string;
    countLabel: string;
    emptyTitle: string;
    emptyDescription: string;
    tone: string;
  }
> = {
  SUBMITTED: {
    heading: "Pending approval",
    countLabel: "submitted savings accounts",
    emptyTitle: "No submitted savings accounts match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
  APPROVED: {
    heading: "Approved",
    countLabel: "approved savings accounts",
    emptyTitle: "No approved savings accounts match",
    emptyDescription: "Change the filter and try again.",
    tone: "up-to-date",
  },
  ACTIVE: {
    heading: "Active",
    countLabel: "active savings accounts",
    emptyTitle: "No active savings accounts match",
    emptyDescription: "Change the filter and try again.",
    tone: "up-to-date",
  },
  INACTIVE: {
    heading: "Inactive",
    countLabel: "inactive savings accounts",
    emptyTitle: "No inactive savings accounts match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
  BLOCKED: {
    heading: "Blocked",
    countLabel: "blocked savings accounts",
    emptyTitle: "No blocked savings accounts match",
    emptyDescription: "Change the filter and try again.",
    tone: "in-arrears",
  },
  CLOSED: {
    heading: "Closed",
    countLabel: "closed savings accounts",
    emptyTitle: "No closed savings accounts match",
    emptyDescription: "Change the filter and try again.",
    tone: "review",
  },
  REJECTED: {
    heading: "Rejected",
    countLabel: "rejected savings accounts",
    emptyTitle: "No rejected savings accounts match",
    emptyDescription: "Change the filter and try again.",
    tone: "in-arrears",
  },
};

export default async function SavingsAccountsPage({
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
  const requestedStatus = parseSavingsStatusFilter(params.status);
  const activeStatusMeta = requestedStatus ? savingsStatusFilterMeta[requestedStatus] : null;
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const normalizedQuery = query.toLowerCase();

  const clientScope: Prisma.ClientWhereInput = {
    organizationId: userScope.organizationId,
    ...clientScopeWhere(userScope),
  };
  const groupScope: Prisma.GroupWhereInput = {
    organizationId: userScope.organizationId,
    ...groupScopeWhere(userScope),
  };

  const searchFilters: Prisma.SavingsAccountWhereInput[] = [];
  if (query) {
    const status = statusAliasToValue[normalizedQuery];
    if (status) searchFilters.push({ status });

    const accountType = accountTypeAliasToValue[normalizedQuery];
    if (accountType) searchFilters.push({ accountType });

    searchFilters.push({ accountNumber: { contains: query, mode: "insensitive" } });
    searchFilters.push({ externalId: { contains: query, mode: "insensitive" } });
    searchFilters.push({ status: { contains: query, mode: "insensitive" } });
    searchFilters.push({ accountType: { contains: query, mode: "insensitive" } });
    searchFilters.push({ client: { is: { firstName: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ client: { is: { middleName: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ client: { is: { lastName: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ client: { is: { accountNumber: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ client: { is: { mobileNumber: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ client: { is: { office: { is: { name: { contains: query, mode: "insensitive" } } } } } });
    searchFilters.push({ group: { is: { name: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ group: { is: { accountNumber: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ group: { is: { office: { is: { name: { contains: query, mode: "insensitive" } } } } } });
    searchFilters.push({ product: { is: { name: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ product: { is: { shortName: { contains: query, mode: "insensitive" } } } });
    searchFilters.push({ fieldOfficer: { is: { name: { contains: query, mode: "insensitive" } } } });
  }

  const where: Prisma.SavingsAccountWhereInput = {
    OR: [{ client: { is: clientScope } }, { group: { is: groupScope } }],
    ...(requestedStatus ? { status: requestedStatus } : {}),
    ...(searchFilters.length > 0 ? { AND: [{ OR: searchFilters }] } : {}),
  };

  const total = await prisma.savingsAccount.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pages);

  const accounts = await prisma.savingsAccount.findMany({
    where,
    include: {
      client: {
        select: {
          accountNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          office: { select: { name: true } },
        },
      },
      group: {
        select: {
          accountNumber: true,
          name: true,
          office: { select: { name: true } },
        },
      },
      product: { select: { name: true } },
      fieldOfficer: { select: { name: true } },
      transactions: { select: { amountMinor: true } },
    },
    orderBy: [{ createdAt: "desc" }, { accountNumber: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const clearStatusHref = query ? `/savings-accounts?query=${encodeURIComponent(query)}` : "/savings-accounts";
  const pageHref = (targetPage: number) => {
    const nextParams = new URLSearchParams();
    if (query) nextParams.set("query", query);
    if (requestedStatus) nextParams.set("status", requestedStatus);
    nextParams.set("page", String(targetPage));
    return `/savings-accounts?${nextParams.toString()}`;
  };
  const statusFilterHref = (status: SupportedSavingsStatusFilter) => {
    const nextParams = new URLSearchParams();
    if (query) nextParams.set("query", query);
    nextParams.set("status", status);
    return `/savings-accounts?${nextParams.toString()}`;
  };

  return (
    <main className="directory-page">
      <Breadcrumbs items={[{ label: "Overview", href: "/" }, { label: "Savings accounts" }]} />
      <header className="directory-header">
        <div>
          <p className="eyebrow">Savings operations</p>
          <h1>{activeStatusMeta ? `Savings accounts — ${activeStatusMeta.heading}` : "Savings accounts"}</h1>
          <p>
            {activeStatusMeta
              ? `${total.toLocaleString()} ${activeStatusMeta.countLabel}`
              : `${total.toLocaleString()} records in your office scope`}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-action" href="/">
            Overview
          </Link>
          <Link className="secondary-action" href="/clients">
            Client directory
          </Link>
        </div>
      </header>
      <div className="directory-toolbar">
        <LiveSearchInput placeholder="Search account, client, group, product, officer or office" />
        <div className="directory-filter-chip">
          <span className="muted-text">Status:</span>
          {supportedStatusFilters.map((status) => {
            const statusMeta = savingsStatusFilterMeta[status];
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
                <th>Account holder</th>
                <th>Account number</th>
                <th>Product</th>
                <th>Status</th>
                <th>Current balance</th>
                <th>Office</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account, index) => {
                const owner = account.client
                  ? {
                      kind: "client" as const,
                      name: fullName(account.client),
                      accountNumber: account.client.accountNumber,
                      officeName: account.client.office.name,
                    }
                  : account.group
                    ? {
                        kind: "group" as const,
                        name: account.group.name,
                        accountNumber: account.group.accountNumber,
                        officeName: account.group.office.name,
                      }
                    : null;
                const holderName = owner?.name ?? "Unknown owner";
                const balanceMinor = account.transactions.reduce(
                  (sum, transaction) => sum + transaction.amountMinor,
                  0n,
                );
                const productName =
                  account.product?.name ?? snapshotString(account.termsSnapshot, "name") ?? "Unlinked product";
                return (
                  <tr key={account.id}>
                    <td className="mono muted-text">{(page - 1) * pageSize + index + 1}</td>
                    <td>
                      <strong>{holderName}</strong>{" "}
                      {owner?.kind === "group" ? <span className="status review">Group</span> : null}
                      <small>
                        {owner ? `${owner.kind === "group" ? "Group" : "Client"} #${owner.accountNumber}` : "Unlinked owner"} ·{" "}
                        {accountTypeLabel(account.accountType)}
                        {account.fieldOfficer?.name ? ` · ${account.fieldOfficer.name}` : ""}
                      </small>
                      <Link
                        aria-label={`Open savings account ${account.accountNumber}`}
                        className="row-link"
                        href={`/savings-accounts/${account.accountNumber}`}
                      />
                    </td>
                    <td className="mono">{account.accountNumber}</td>
                    <td>{productName}</td>
                    <td>
                      <span className={`status ${statusTone(account.status)}`}>{statusLabel(account.status)}</span>
                    </td>
                    <td className="mono">{formatMinor(balanceMinor, account.currencyCode)}</td>
                    <td>{owner?.officeName ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {accounts.length === 0 ? (
          <div className="empty-state">
            <PiggyBank size={28} />
            <strong>{activeStatusMeta ? activeStatusMeta.emptyTitle : query ? "No matching savings accounts" : "No savings accounts yet"}</strong>
            <p>
              {activeStatusMeta
                ? activeStatusMeta.emptyDescription
                : query
                  ? "Change the search and try again."
                  : "Savings, share and deposit accounts will appear here once they are opened for clients in your office scope."}
            </p>
            <Link className="invest-button empty-action" href={query || activeStatusMeta ? "/savings-accounts" : "/clients"}>
              {query || activeStatusMeta ? "Show all accounts" : "Open from a client record"}
            </Link>
          </div>
        ) : null}
        <nav aria-label="Savings account pages" className="pagination">
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

function parseSavingsStatusFilter(status?: string): SupportedSavingsStatusFilter | null {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) return null;
  return supportedStatusFilters.find((value) => value === normalized) ?? null;
}

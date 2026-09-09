import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientScopeWhere, getUserDataScope, groupScopeWhere, loanScopeWhere } from "@/modules/identity/application/data-scope";

type SearchDestination = {
  entity: "clients" | "groups" | "loans" | "savings-accounts";
  href: string;
  query: string;
  strategy: "default" | "detail" | "list";
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json(defaultDestination(""));

  const [clientExactMatches, groupExactMatches, loanExactMatches, savingsExactMatches] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: scope.organizationId, ...clientScopeWhere(scope), accountNumber: query },
      select: { accountNumber: true },
      take: 2,
    }),
    prisma.group.findMany({
      where: { organizationId: scope.organizationId, ...groupScopeWhere(scope), accountNumber: query },
      select: { accountNumber: true },
      take: 2,
    }),
    prisma.loan.findMany({
      where: { office: { organizationId: scope.organizationId }, ...loanScopeWhere(scope), accountNumber: { equals: query, mode: "insensitive" } },
      select: { id: true },
      take: 2,
    }),
    prisma.savingsAccount.findMany({
      where: {
        accountNumber: { equals: query, mode: "insensitive" },
        OR: [
          { client: { is: { organizationId: scope.organizationId, ...clientScopeWhere(scope) } } },
          { group: { is: { organizationId: scope.organizationId, ...groupScopeWhere(scope) } } },
        ],
      },
      select: { accountNumber: true },
      take: 2,
    }),
  ]);

  const exactMatches = [
    ...clientExactMatches.map((client) => detailDestination("clients", `/clients/${client.accountNumber}`, query)),
    ...groupExactMatches.map((group) => detailDestination("groups", `/groups/${group.accountNumber}`, query)),
    ...loanExactMatches.map((loan) => detailDestination("loans", `/loans/${loan.id}`, query)),
    ...savingsExactMatches.map((account) => detailDestination("savings-accounts", `/savings-accounts/${account.accountNumber}`, query)),
  ];
  if (exactMatches.length === 1) return NextResponse.json(exactMatches[0]);

  const [clientAccountHits, groupAccountHits, loanAccountHits, savingsAccountHits] = await Promise.all([
    prisma.client.count({
      where: { organizationId: scope.organizationId, ...clientScopeWhere(scope), accountNumber: { contains: query } },
    }),
    prisma.group.count({
      where: { organizationId: scope.organizationId, ...groupScopeWhere(scope), accountNumber: { contains: query, mode: "insensitive" } },
    }),
    prisma.loan.count({
      where: { office: { organizationId: scope.organizationId }, ...loanScopeWhere(scope), accountNumber: { contains: query, mode: "insensitive" } },
    }),
    prisma.savingsAccount.count({
      where: {
        accountNumber: { contains: query, mode: "insensitive" },
        OR: [
          { client: { is: { organizationId: scope.organizationId, ...clientScopeWhere(scope) } } },
          { group: { is: { organizationId: scope.organizationId, ...groupScopeWhere(scope) } } },
        ],
      },
    }),
  ]);

  const matchingLists = [
    clientAccountHits > 0 ? listDestination("clients", query) : null,
    groupAccountHits > 0 ? listDestination("groups", query) : null,
    loanAccountHits > 0 ? listDestination("loans", query) : null,
    savingsAccountHits > 0 ? listDestination("savings-accounts", query) : null,
  ].filter((destination): destination is SearchDestination => destination !== null);

  if (matchingLists.length === 1) return NextResponse.json(matchingLists[0]);

  return NextResponse.json(defaultDestination(query));
}

function defaultDestination(query: string): SearchDestination {
  return query ? listDestination("clients", query) : { entity: "clients", href: "/clients", query, strategy: "default" };
}

function detailDestination(entity: SearchDestination["entity"], href: string, query: string): SearchDestination {
  return { entity, href, query, strategy: "detail" };
}

function listDestination(entity: SearchDestination["entity"], query: string): SearchDestination {
  return { entity, href: `/${entity}?query=${encodeURIComponent(query)}`, query, strategy: "list" };
}

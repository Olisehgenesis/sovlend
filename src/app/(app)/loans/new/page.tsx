import { Search } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateLoanApplicationForm } from "@/components/create-loan-application-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { formatMinor } from "@/modules/money/domain/format-minor";

export default async function NewLoanApplicationPage({ searchParams }: { searchParams: Promise<{ query?: string; clientId?: string; groupId?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) redirect("/");
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const clientSearch = query ? { OR: [{ firstName: { contains: query, mode: "insensitive" as const } }, { lastName: { contains: query, mode: "insensitive" as const } }, { accountNumber: { contains: query } }, { mobileNumber: { contains: query } }] } : {};
  const [clients, selectedClient, products, groups, selectedGroup] = await Promise.all([
    prisma.client.findMany({ where: { organizationId: scope.organizationId, ...officeWhere(scope), status: "ACTIVE", ...clientSearch }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], take: 50 }),
    params.clientId ? prisma.client.findFirst({ where: { id: params.clientId, organizationId: scope.organizationId, ...officeWhere(scope), status: "ACTIVE" } }) : null,
    prisma.loanProduct.findMany({ where: { organizationId: scope.organizationId, active: true }, orderBy: { name: "asc" } }),
    prisma.group.findMany({ where: { organizationId: scope.organizationId, ...officeWhere(scope), status: "ACTIVE" }, orderBy: { name: "asc" }, take: 100 }),
    params.groupId ? prisma.group.findFirst({ where: { id: params.groupId, organizationId: scope.organizationId, ...officeWhere(scope), status: "ACTIVE" } }) : null,
  ]);
  const availableClients = selectedClient && !clients.some((client) => client.id === selectedClient.id) ? [selectedClient, ...clients] : clients;
  const availableGroups = selectedGroup && !groups.some((group) => group.id === selectedGroup.id) ? [selectedGroup, ...groups] : groups;

  return <main className="directory-page"><Breadcrumbs items={[{ label: "Loans", href: "/loans" }, { label: "New application" }]} /><header className="directory-header"><div><p className="eyebrow">Loan origination</p><h1>New loan application</h1><p>Choose an active borrower and product. A different authorized user must approve it.</p></div><Link className="secondary-action" href="/loans">Cancel</Link></header><form className="directory-search"><Search size={17} /><input name="query" defaultValue={query} placeholder="Find active client by name, account or mobile" /><button type="submit">Find client</button></form>{availableClients.length === 0 && availableGroups.length === 0 ? <section className="panel"><div className="empty-state"><Search size={28} /><strong>No active clients found</strong><p>Try another name, account number, or mobile number.</p><Link className="invest-button empty-action" href="/clients/new">Create client</Link></div></section> : <section className="panel form-panel"><CreateLoanApplicationForm clients={availableClients.map((client) => ({ id: client.id, name: [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" "), accountNumber: client.accountNumber }))} groups={availableGroups.map((group) => ({ id: group.id, name: group.name, accountNumber: group.accountNumber }))} products={products.map((product) => ({ id: product.id, name: product.name, currency: product.denominationCurrency, minimum: formatMinor(product.principalMinMinor, product.denominationCurrency).replace(`${product.denominationCurrency} `, ""), maximum: formatMinor(product.principalMaxMinor, product.denominationCurrency).replace(`${product.denominationCurrency} `, "") }))} selectedClientId={selectedClient?.id} selectedGroupId={selectedGroup?.id} /></section>}</main>;
}
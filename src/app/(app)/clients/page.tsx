import { Download, UserPlus, Users } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveSearchInput } from "@/components/live-search-input";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ query?: string; page?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const userScope = await getUserDataScope(prisma, session.user.id);
  if (!userScope) redirect("/");
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 25;
  const scope = { organizationId: userScope.organizationId, ...officeWhere(userScope) };
  const search = query ? { OR: [{ firstName: { contains: query, mode: "insensitive" as const } }, { lastName: { contains: query, mode: "insensitive" as const } }, { accountNumber: { contains: query } }, { mobileNumber: { contains: query } }] } : {};
  const [clients, total] = await Promise.all([
    prisma.client.findMany({ where: { ...scope, ...search }, include: { office: { select: { name: true } } }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.client.count({ where: { ...scope, ...search } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return <main className="directory-page"><header className="directory-header"><div><p className="eyebrow">Customer directory</p><h1>Clients</h1><p>{total.toLocaleString()} records in your office scope</p></div><div className="header-actions"><Link className="secondary-action" href="/"><span>Overview</span></Link><a className="secondary-action" href="/api/clients/export"><Download size={16} /> Export CSV</a><Link className="invest-button" href="/clients/new"><UserPlus size={16} /> Create client</Link></div></header><LiveSearchInput placeholder="Search name, account or mobile" /><section className="panel"><div className="table-scroll"><table className="clickable-rows"><thead><tr><th>#</th><th>Client</th><th>Account</th><th>Mobile</th><th>Office</th><th>Status</th></tr></thead><tbody>{clients.map((client, index) => <tr key={client.id}><td className="mono muted-text">{(page - 1) * pageSize + index + 1}</td><td><strong>{[client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ")}</strong><Link className="row-link" href={`/clients/${client.accountNumber}`} aria-label={`Open ${[client.firstName, client.lastName].filter(Boolean).join(" ")}`} /></td><td className="mono">{client.accountNumber}</td><td>{client.mobileNumber ?? "Not provided"}</td><td>{client.office.name}</td><td><span className={`status ${client.status === "ACTIVE" ? "up-to-date" : "review"}`}>{client.status}</span></td></tr>)}</tbody></table></div>{clients.length === 0 ? <div className="empty-state"><Users size={28} /><strong>No matching clients</strong><p>Change the search and try again.</p></div> : null}<nav className="pagination" aria-label="Client pages"><Link aria-disabled={page <= 1} href={`/clients?query=${encodeURIComponent(query)}&page=${Math.max(1, page - 1)}`}>Previous</Link><span>Page {page} of {pages}</span><Link aria-disabled={page >= pages} href={`/clients?query=${encodeURIComponent(query)}&page=${Math.min(pages, page + 1)}`}>Next</Link></nav></section></main>;
}
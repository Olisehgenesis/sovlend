import { Boxes, Building2, Database, KeyRound, ShieldCheck, TrendingUp, UserRoundCog } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { ImportLegacyClientForm } from "@/components/import-legacy-client-form";
import { InvestorInviteForm } from "@/components/investor-invite-form";

export default async function BackofficePage() {
  const session = await requireSuperAdmin();
  const [organizations, offices, users, investors, accessRequests, migrations] = await Promise.all([
    prisma.organization.count(),
    prisma.office.count(),
    prisma.user.count(),
    prisma.investorProfile.count(),
    prisma.investorAccessRequest.count({ where: { status: "REQUESTED" } }),
    prisma.migrationRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const organizationOptions = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const adminUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } });
  const officeOptions = adminUser?.organizationId ? await prisma.office.findMany({ where: { organizationId: adminUser.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  return <main className="backoffice-page"><header className="backoffice-header"><div><p className="eyebrow">Admin panel</p><h1>System management</h1><p>Signed in as {session.user.email}</p></div><span className="super-admin-badge"><ShieldCheck size={16} /> Super administrator</span></header><section className="backoffice-metrics"><article><Building2 size={18} /><span>Businesses</span><strong>{organizations}</strong><small>{offices} branches</small></article><article><UserRoundCog size={18} /><span>Users</span><strong>{users}</strong><small>Managed identities</small></article><article><TrendingUp size={18} /><span>Investors</span><strong>{investors}</strong><small>{accessRequests} access requests</small></article><article><Database size={18} /><span>Migrations</span><strong>{migrations.length}</strong><small>Recorded runs</small></article></section><section className="backoffice-grid"><a className="management-link" href="/admin/users"><UserRoundCog size={22} /><span><strong>Users and permissions</strong><small>Create users, assign branches and permission groups.</small></span></a><a className="management-link" href="/backoffice/accounting"><Database size={22} /><span><strong>Accounting mappings</strong><small>Connect products and settlement channels to verified GL accounts.</small></span></a><a className="management-link" href="/backoffice/products"><Boxes size={22} /><span><strong>Products</strong><small>Loan, savings and charge templates used across client accounts.</small></span></a><a className="management-link" href="/settings/security"><KeyRound size={22} /><span><strong>Security and passkeys</strong><small>Register phishing-resistant authentication.</small></span></a><ImportLegacyClientForm offices={officeOptions} /><InvestorInviteForm organizations={organizationOptions} /><article className="panel migration-status"><div className="panel-heading"><div><h2>Migration history</h2><p>Verified legacy imports only</p></div><Database size={18} /></div>{migrations.length === 0 ? <div className="empty-state"><Database size={28} /><strong>No imported runs</strong><p>Extraction remains outside the application until checksum verification passes.</p></div> : <div className="table-scroll"><table><thead><tr><th>Source</th><th>Tenant</th><th>Status</th><th>Started</th></tr></thead><tbody>{migrations.map((run) => <tr key={run.id}><td>{run.sourceSystem}</td><td>{run.sourceTenant}</td><td>{run.status}</td><td>{run.startedAt?.toLocaleString() ?? "Not started"}</td></tr>)}</tbody></table></div>}</article></section></main>;
}
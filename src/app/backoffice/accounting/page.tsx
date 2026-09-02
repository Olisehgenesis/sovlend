import Link from "next/link";

import { ProductMappingForm, SettlementMappingForm } from "@/components/accounting-mapping-forms";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/require-super-admin";

export default async function AccountingSetupPage() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { organizationId: true } });
  if (!user.organizationId) throw new Error("Super administrator requires an organization");
  const [accounts, products, settlementAccounts] = await Promise.all([
    prisma.ledgerAccount.findMany({ where: { currencyCode: "UGX", active: true, usage: "DETAIL" }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
    prisma.loanProduct.findMany({ where: { organizationId: user.organizationId }, include: { accountingMapping: true }, orderBy: { name: "asc" } }),
    prisma.settlementAccount.findMany({ where: { organizationId: user.organizationId, currencyCode: "UGX" }, orderBy: [{ active: "desc" }, { type: "asc" }, { name: "asc" }] }),
  ]);
  const accountOptions = accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, type: account.type }));
  const configuredProducts = products.filter((product) => product.accountingMapping).length;
  const activeSettlementAccounts = settlementAccounts.filter((account) => account.active).length;
  const setupComplete = configuredProducts === products.length && activeSettlementAccounts > 0;
  return <main className="directory-page"><Breadcrumbs items={[{ label: "Backoffice", href: "/backoffice" }, { label: "Accounting mappings" }]} /><header className="directory-header"><div><p className="eyebrow">Financial controls</p><h1>Accounting mappings</h1><p>Connect each operational flow to the verified chart of accounts before money can move.</p></div><Link className="secondary-action" href="/backoffice">Backoffice</Link></header><section className={`readiness-banner ${setupComplete ? "ready" : "attention"}`}><div><strong>{setupComplete ? "Accounting setup complete" : "Setup required before disbursement"}</strong><span>{activeSettlementAccounts} active settlement account{activeSettlementAccounts === 1 ? "" : "s"} · {configuredProducts} of {products.length} loan products configured</span></div><div className="readiness-progress"><i style={{ width: `${Math.round(((Math.min(activeSettlementAccounts, 1) + configuredProducts) / (1 + products.length)) * 100)}%` }} /></div></section><section className="accounting-setup"><article className="panel"><SettlementMappingForm organizationId={user.organizationId} assetAccounts={accountOptions.filter((account) => account.type === "ASSET")} accounts={settlementAccounts} /></article><article className="panel product-mappings"><div className="panel-heading"><div><h2>Loan product mappings</h2><p>Open an incomplete product to select the accounts used by disbursement and repayment.</p></div><span className="mapping-count">{configuredProducts}/{products.length}</span></div>{products.map((product) => <ProductMappingForm key={product.id} product={{ id: product.id, name: product.name, mapping: product.accountingMapping }} accounts={accountOptions} />)}</article></section></main>;
}